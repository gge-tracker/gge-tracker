import { Request, Response } from 'express';

/**
 * A service that manages a queue of asynchronous request handlers, ensuring that only one handler runs at a time.
 *
 * This is useful for serializing access to resources or APIs that should not be accessed concurrently.
 *
 * @remarks
 * - Each job consists of an Express `Request`, `Response`, and an async handler function.
 * - If a handler throws an error, a 500 response is sent if possible.
 */
export class QueueService {
  /**
   * Indicates whether the queue service is currently processing tasks.
   * When `true`, the service is actively running; when `false`, it is idle.
   */
  private running = false;
  /**
   * Internal queue to store incoming HTTP requests along with their corresponding response objects
   * and asynchronous handler functions. Each entry in the queue represents a pending request to be
   * processed by the service.
   *
   * @remarks
   * The queue is an array of objects, each containing:
   * - `req`: The Express `Request` object representing the incoming HTTP request.
   * - `res`: The Express `Response` object used to send a response back to the client.
   * - `handler`: An asynchronous function that processes the request and response.
   */
  private queue: { req: Request; res: Response; handler: (req: Request, res: Response) => Promise<any> }[] = [];

  /**
   * Adds a new request, response, and handler function to the processing queue and triggers the next queue execution.
   *
   * @param req - The Express request object to be enqueued.
   * @param res - The Express response object to be enqueued.
   * @param handler - An asynchronous function that handles the request and response.
   */
  public enqueue(req: Request, res: Response, handler: (req: Request, res: Response) => Promise<any>): void {
    this.queue.push({ req, res, handler });
    void this.runNext();
  }

  /**
   * Processes the next job in the queue if no job is currently running.
   *
   * This method checks if a job is already running; if not, it dequeues the next job and executes its handler.
   * Handles errors by logging them and sending a 500 response if possible.
   * After completion (success or failure), it marks the job as not running and recursively processes the next job in the queue.
   *
   * @returns {Promise<void>} A promise that resolves when the job processing is complete.
   * @private
   */
  private async runNext(): Promise<void> {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) return;

    this.running = true;
    try {
      await job.handler(job.req, job.res);
    } catch (err) {
      const date = new Date().toISOString();
      console.error(`[${date}] QueueService error:`, err);
      if (!job.res.headersSent) {
        job.res.status(500).json({ error: 'Internal Server Error. Please try again later.' });
      }
    } finally {
      this.running = false;
      void this.runNext();
    }
  }
}
