import type { Browser, Page } from 'puppeteer' with { 'resolution-mode': 'import' };

const IDLE_SHUTDOWN_MS = Number(process.env.PUPPETEER_IDLE_SHUTDOWN_MS) || 5 * 60 * 1000;
const MAX_CONCURRENT_PAGES = Number(process.env.PUPPETEER_MAX_PAGES) || 8;
const PAGE_TIMEOUT_MS = Number(process.env.PUPPETEER_PAGE_TIMEOUT_MS) || 30_000;
const MAX_BROWSER_AGE_MS = Number(process.env.PUPPETEER_MAX_BROWSER_AGE_MS) || 60 * 60 * 1000;
const MAX_PAGES_PER_BROWSER = Number(process.env.PUPPETEER_MAX_PAGES_PER_BROWSER) || 2000;

export type RenderPriority = 'high' | 'low';

const QUEUE_LIMITS: Record<RenderPriority, { maxWaitMs: number; maxWaiting: number }> = {
  high: {
    maxWaitMs: Number(process.env.PUPPETEER_HIGH_MAX_WAIT_MS) || 60_000,
    maxWaiting: Number(process.env.PUPPETEER_HIGH_MAX_WAITING) || 200,
  },
  low: {
    maxWaitMs: Number(process.env.PUPPETEER_LOW_MAX_WAIT_MS) || 10_000,
    maxWaiting: Number(process.env.PUPPETEER_LOW_MAX_WAITING) || 32,
  },
};

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--disable-software-rasterizer',
  '--disable-accelerated-2d-canvas',
  '--disable-background-timer-throttling',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-sync',
  '--metrics-recording-only',
  '--mute-audio',
  '--no-first-run',
  '--no-zygote',
  '--ignore-certificate-errors',
  '--window-size=800,600',
];

export class RenderBusyError extends Error {
  constructor(reason: string) {
    super(`The renderer is busy: ${reason}`);
    this.name = 'RenderBusyError';
  }
}

interface BrowserLease {
  browser: Browser;
  launchedAt: number;
  pagesOpened: number;
  activePages: number;
}

interface Waiter {
  grant: () => void;
  timer: NodeJS.Timeout;
}

class PuppeteerManager {
  private current: BrowserLease | null = null;
  private launch: Promise<BrowserLease> | null = null;
  private openPages = 0;
  private readonly waiting: Record<RenderPriority, Waiter[]> = { high: [], low: [] };
  private idleTimer: NodeJS.Timeout | null = null;

  public async withPage<T>(run: (page: Page) => Promise<T>, priority: RenderPriority = 'high'): Promise<T> {
    await this.acquireSlot(priority);
    this.cancelIdleShutdown();
    let lease: BrowserLease | null = null;
    let page: Page | null = null;
    try {
      lease = await this.leaseBrowser();
      page = await lease.browser.newPage();
      page.setDefaultTimeout(PAGE_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
      return await run(page);
    } catch (error) {
      // An unanswered protocol call means the browser itself hangs, and every later page would wait on it too
      if (lease && this.isUnresponsive(error)) this.kill(lease, 'it stopped answering');
      throw error;
    } finally {
      if (page) await page.close().catch(() => null);
      if (lease) this.returnLease(lease);
      this.releaseSlot();
    }
  }

  public getPageTimeoutMs(): number {
    return PAGE_TIMEOUT_MS;
  }

  public async close(): Promise<void> {
    this.cancelIdleShutdown();
    const lease = this.current;
    this.current = null;
    if (lease) await lease.browser.close().catch(() => null);
  }

  private async leaseBrowser(): Promise<BrowserLease> {
    if (this.current && !this.current.browser.connected) this.current = null;
    if (this.current && this.isWornOut(this.current)) this.retire(this.current);
    // A failed launch must not leave later callers waiting forever, so the shared promise is
    // dropped as soon as it settles and the next caller starts a fresh attempt
    const lease =
      this.current ??
      (await (this.launch ??= this.launchBrowser().finally(() => {
        this.launch = null;
      })));
    lease.pagesOpened++;
    lease.activePages++;
    return lease;
  }

  private returnLease(lease: BrowserLease): void {
    lease.activePages--;
    if (lease !== this.current && lease.activePages === 0) void lease.browser.close().catch(() => null);
  }

  private isWornOut(lease: BrowserLease): boolean {
    return Date.now() - lease.launchedAt > MAX_BROWSER_AGE_MS || lease.pagesOpened >= MAX_PAGES_PER_BROWSER;
  }

  private retire(lease: BrowserLease): void {
    logBrowserEvent(`retiring the browser after ${lease.pagesOpened} pages`);
    this.current = null;
    if (lease.activePages === 0) void lease.browser.close().catch(() => null);
  }

  private kill(lease: BrowserLease, reason: string): void {
    logBrowserEvent(`killing the browser because ${reason}`);
    if (this.current === lease) this.current = null;
    lease.browser.process()?.kill('SIGKILL');
  }

  private isUnresponsive(error: unknown): boolean {
    return error instanceof Error && error.name === 'ProtocolError' && error.message.includes('timed out');
  }

  private async launchBrowser(): Promise<BrowserLease> {
    logBrowserEvent(`launching the browser`);
    const { launch } = await import('puppeteer');
    const browser = await launch({ headless: true, args: LAUNCH_ARGS, protocolTimeout: PAGE_TIMEOUT_MS });
    const lease: BrowserLease = { browser, launchedAt: Date.now(), pagesOpened: 0, activePages: 0 };
    // Relaunching from here would resurrect the browser during shutdown and recurse on a crash
    // loop; leaseBrowser reopens it lazily on the next render instead
    browser.on('disconnected', () => {
      if (this.current === lease) this.current = null;
    });
    this.current = lease;
    return lease;
  }

  private async acquireSlot(priority: RenderPriority): Promise<void> {
    if (this.openPages < MAX_CONCURRENT_PAGES) {
      this.openPages++;
      return;
    }
    const { maxWaitMs, maxWaiting } = QUEUE_LIMITS[priority];
    const queue = this.waiting[priority];
    if (queue.length >= maxWaiting) throw new RenderBusyError(`${queue.length} ${priority} renders already waiting`);
    // The slot is handed over directly by releaseSlot, so openPages is never briefly free here
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => {
          clearTimeout(waiter.timer);
          resolve();
        },
        timer: setTimeout(() => {
          queue.splice(queue.indexOf(waiter), 1);
          reject(new RenderBusyError(`no page freed up within ${maxWaitMs} ms`));
        }, maxWaitMs),
      };
      queue.push(waiter);
    });
  }

  private releaseSlot(): void {
    const next = this.waiting.high.shift() ?? this.waiting.low.shift();
    if (next) {
      next.grant();
      return;
    }
    this.openPages--;
    if (this.openPages === 0) this.scheduleIdleShutdown();
  }

  private scheduleIdleShutdown(): void {
    this.cancelIdleShutdown();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.openPages === 0) {
        logBrowserEvent('closing the idle browser');
        void this.close();
      }
    }, IDLE_SHUTDOWN_MS);
    this.idleTimer.unref?.();
  }

  private cancelIdleShutdown(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

function logBrowserEvent(message: string): void {
  console.log(`[Puppeteer] ${message} at ${new Date().toISOString()}`);
}

export const puppeteerManagerInstance = new PuppeteerManager();
