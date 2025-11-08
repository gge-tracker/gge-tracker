import * as puppeteer from 'puppeteer';

/**
 * Singleton class to manage a single Puppeteer browser instance.
 *
 * Ensures that only one browser instance is launched and reused throughout the application.
 * Handles concurrent launch attempts and automatically relaunches the browser if it crashes.
 */
class PuppeteerManager {
  /**
   * Holds the instance of the Puppeteer browser.
   *
   * This property is either a `puppeteer.Browser` object when the browser is initialized,
   * or `null` if the browser has not been launched or has been closed.
   */
  private browser: puppeteer.Browser | null = null;
  /**
   * Indicates whether the Puppeteer browser instance is currently in the process of launching.
   * Used to prevent multiple simultaneous launch attempts.
   */
  private launching: boolean = false;

  /**
   * Retrieves the current Puppeteer browser instance.
   * If the browser is not already launched, it will launch a new instance before returning it.
   *
   * @returns A promise that resolves to the Puppeteer `Browser` instance.
   */
  public async getBrowser(): Promise<puppeteer.Browser> {
    if (!this.browser) {
      await this.launchBrowser();
    }
    return this.browser;
  }

  /**
   * Creates and returns a new Puppeteer page instance.
   *
   * This method retrieves the current browser instance (launching it if necessary)
   * and opens a new page (tab) within that browser context.
   *
   * @returns {Promise<puppeteer.Page>} A promise that resolves to the newly created Puppeteer page.
   */
  public async createPage(): Promise<puppeteer.Page> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    return page;
  }

  /**
   * Launches a new Puppeteer browser instance if one is not already being launched.
   * Ensures that only one browser launch is in progress at a time by waiting if another launch is ongoing.
   * Configures the browser with a set of arguments optimized for headless operation and security.
   * Automatically attempts to relaunch the browser if it crashes or disconnects.
   *
   * @returns {Promise<puppeteer.Browser>} A promise that resolves to the launched Puppeteer browser instance.
   * @throws Will throw an error if the browser fails to launch.
   */
  private async launchBrowser(): Promise<puppeteer.Browser> {
    if (this.launching) {
      while (this.launching) await new Promise((resolve) => setTimeout(resolve, 50));
      return this.browser;
    }

    this.launching = true;
    const date = new Date().toISOString();
    console.log(`[Puppeteer] The browser is launching at ${date}...`);
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
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
      ],
    });
    this.browser.on('disconnected', () => {
      const date = new Date().toISOString();
      console.error(`[Puppeteer] The browser crashed at ${date}. Relaunching...`);
      this.browser = null;
      this.launchBrowser().catch((error) => console.error('[Puppeteer] Relaunch failed', error));
    });
    this.launching = false;
    return this.browser;
  }
}
export const puppeteerManagerInstance = new PuppeteerManager();
