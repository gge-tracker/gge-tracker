import type { Browser, Page } from 'puppeteer' with { 'resolution-mode': 'import' };

const IDLE_SHUTDOWN_MS = Number(process.env.PUPPETEER_IDLE_SHUTDOWN_MS) || 5 * 60 * 1000;
const MAX_CONCURRENT_PAGES = Number(process.env.PUPPETEER_MAX_PAGES) || 4;
const PAGE_TIMEOUT_MS = Number(process.env.PUPPETEER_PAGE_TIMEOUT_MS) || 30_000;

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
  '--single-process',
  '--ignore-certificate-errors',
  '--window-size=800,600',
];

class PuppeteerManager {
  private browser: Browser | null = null;
  private launch: Promise<Browser> | null = null;
  private openPages = 0;
  private readonly waiting: (() => void)[] = [];
  private idleTimer: NodeJS.Timeout | null = null;

  public async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    // A failed launch must not leave later callers waiting forever, so the shared promise is
    // dropped as soon as it settles and the next caller starts a fresh attempt
    this.launch ??= this.launchBrowser().finally(() => {
      this.launch = null;
    });
    return this.launch;
  }

  public async withPage<T>(run: (page: Page) => Promise<T>): Promise<T> {
    await this.acquireSlot();
    this.cancelIdleShutdown();
    let page: Page | null = null;
    try {
      const browser = await this.getBrowser();
      page = await browser.newPage();
      page.setDefaultTimeout(PAGE_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
      return await run(page);
    } finally {
      if (page) {
        await page.close().catch(() => null);
      }
      this.releaseSlot();
    }
  }

  public getPageTimeoutMs(): number {
    return PAGE_TIMEOUT_MS;
  }

  public async close(): Promise<void> {
    this.cancelIdleShutdown();
    const browser = this.browser;
    this.browser = null;
    if (browser) await browser.close().catch(() => null);
  }

  private async launchBrowser(): Promise<Browser> {
    logBrowserEvent(`launching the browser`);
    const { launch } = await import('puppeteer');
    const browser = await launch({ headless: true, args: LAUNCH_ARGS });
    // Relaunching from here would resurrect the browser during shutdown and recurse on a crash
    // loop; getBrowser reopens it lazily on the next render instead
    browser.on('disconnected', () => {
      if (this.browser === browser) this.browser = null;
    });
    this.browser = browser;
    return browser;
  }

  private async acquireSlot(): Promise<void> {
    if (this.openPages < MAX_CONCURRENT_PAGES) {
      this.openPages++;
      return;
    }
    // The slot is handed over directly by releaseSlot, so openPages is never briefly free here
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private releaseSlot(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
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
