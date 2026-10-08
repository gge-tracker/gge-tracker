import { sleep } from './harness.js';

export class CommandBudgetExceeded extends Error {}

export class Pacer {
  private sent = 0;
  private lastBatchAt = 0;

  constructor(
    private readonly gapMs: number,
    private readonly budget: number,
  ) {}

  public get used(): number {
    return this.sent;
  }

  public async run<T>(commands: number, send: () => Promise<T>): Promise<T> {
    if (this.sent + commands > this.budget) {
      throw new CommandBudgetExceeded(
        `the run would send ${this.sent + commands} game commands, budget is ${this.budget}`,
      );
    }
    const wait = this.lastBatchAt + this.gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.sent += commands;
    try {
      return await send();
    } finally {
      this.lastBatchAt = Date.now();
    }
  }
}
