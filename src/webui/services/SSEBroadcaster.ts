import type { Response } from 'express';
import type { ActivityEvent } from '../../types/activity.js';
import { getEventBus } from '../../core/EventBus.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ module: 'SSEBroadcaster' });

/**
 * Broadcasts activity events to SSE clients.
 * Subscribes to EventBus 'activity' events and pushes to all connected clients.
 */
export class SSEBroadcaster {
  private readonly clients = new Set<Response>();

  constructor() {
    const eventBus = getEventBus();
    eventBus.on('activity', (event: ActivityEvent) => this.broadcast(event));
    log.info('SSEBroadcaster initialized, listening for activity events');
  }

  /**
   * Add an SSE client connection.
   * Sets proper headers and sends initial heartbeat.
   */
  addClient(res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial heartbeat
    res.write(':ok\n\n');

    this.clients.add(res);
    log.debug({ clientCount: this.clients.size }, 'SSE client connected');

    // Remove client on disconnect
    res.on('close', () => {
      this.clients.delete(res);
      log.debug({ clientCount: this.clients.size }, 'SSE client disconnected');
    });
  }

  /**
   * Broadcast an activity event to all connected SSE clients.
   */
  private broadcast(event: ActivityEvent): void {
    if (this.clients.size === 0) return;

    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(data);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  /** Number of connected clients */
  get clientCount(): number {
    return this.clients.size;
  }
}
