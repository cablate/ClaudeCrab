/**
 * DiscordRateLimiter — simple queue-based rate limiter for Discord send operations.
 *
 * Extracted from DiscordAdapter.ts to reduce file size.
 * Maintains a send queue and ensures minimum interval between sends (~1.2s).
 */

export class DiscordRateLimiter {
  /** Pending send queue */
  private sendQueue: Array<() => Promise<void>> = [];
  private isFlushing = false;
  private lastSendTime = 0;
  static readonly MIN_SEND_INTERVAL_MS = 1200;

  /**
   * Queue a send operation with rate limiting.
   * Returns a Promise that resolves when the operation completes.
   */
  async rateLimitedSend<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.sendQueue.push(async () => {
        try {
          const now = Date.now();
          const elapsed = now - this.lastSendTime;
          if (elapsed < DiscordRateLimiter.MIN_SEND_INTERVAL_MS) {
            await new Promise(r => setTimeout(r, DiscordRateLimiter.MIN_SEND_INTERVAL_MS - elapsed));
          }
          this.lastSendTime = Date.now();
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });

      if (!this.isFlushing) {
        void this.flushSendQueue();
      }
    });
  }

  private async flushSendQueue(): Promise<void> {
    if (this.isFlushing) return;
    this.isFlushing = true;

    while (this.sendQueue.length > 0) {
      const task = this.sendQueue.shift();
      if (task !== undefined) {
        await task();
      }
    }

    this.isFlushing = false;
  }
}
