class AsyncEvent {
  public isSet: boolean = false;
  private target: EventTarget;

  constructor() {
    this.target = new EventTarget();
  }

  public set(): void {
    this.isSet = true;
    this.target.dispatchEvent(new Event('set'));
  }

  public clear(): void {
    this.isSet = false;
  }

  public async wait(timeout = -1): Promise<boolean> {
    if (this.isSet) return true;
    if (timeout === 0) return false;
    if (timeout === -1) {
      return await new Promise((resolve) => {
        this.target.addEventListener('set', () => resolve(true), { once: true });
      });
    }

    return new Promise((resolve) => {
      const onSet = (): void => {
        clearTimeout(timeoutId);
        resolve(true);
      };
      const timeoutId = setTimeout(() => {
        this.target.removeEventListener('set', onSet);
        resolve(false);
      }, timeout);

      this.target.addEventListener('set', onSet);
    });
  }
}

export { AsyncEvent };
