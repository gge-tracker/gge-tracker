import { Request, Response } from 'express';

interface QueuedJob {
  req: Request;
  res: Response;
  handler: (request: Request, response: Response) => Promise<any>;
  enqueuedAt: number;
}

const BUSY_BODY = { error: 'Game server is busy. Please try again later.', code: 'GAME_SERVER_BUSY' };

// One handler at a time per lane
export class QueueService {
  private running = false;
  private readonly queue: QueuedJob[] = [];

  constructor(
    private readonly maxLength = Number(process.env.CASTLE_QUEUE_MAX_LENGTH) || 50,
    private readonly maxWaitMs = Number(process.env.CASTLE_QUEUE_MAX_WAIT_MS) || 20_000,
  ) {}

  public enqueue(
    request: Request,
    response: Response,
    handler: (request_: Request, response_: Response) => Promise<any>,
  ): void {
    if (this.queue.length >= this.maxLength) {
      response.status(503).json(BUSY_BODY);
      return;
    }
    this.queue.push({ req: request, res: response, handler, enqueuedAt: Date.now() });
    void this.runNext();
  }

  private async runNext(): Promise<void> {
    if (this.running) return;
    const job = this.nextLiveJob();
    if (!job) return;

    this.running = true;
    try {
      await job.handler(job.req, job.res);
    } catch (error) {
      const date = new Date().toISOString();
      console.error(`[${date}] QueueService error:`, error);
      if (!job.res.headersSent) {
        job.res.status(500).json({ error: 'Internal Server Error. Please try again later.' });
      }
    } finally {
      this.running = false;
      void this.runNext();
    }
  }

  private nextLiveJob(): QueuedJob | undefined {
    let job = this.queue.shift();
    while (job) {
      if (job.res.headersSent || job.req.socket?.destroyed) {
        job = this.queue.shift();
        continue;
      }
      if (Date.now() - job.enqueuedAt > this.maxWaitMs) {
        job.res.status(503).json(BUSY_BODY);
        job = this.queue.shift();
        continue;
      }
      return job;
    }
    return undefined;
  }
}
