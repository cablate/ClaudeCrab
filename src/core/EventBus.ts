import type { EventMap, EventHandler, EventName } from '../types/events.js';
import { logger } from '../utils/logger.js';

/**
 * Type-safe event bus for system-wide events
 * Supports multiple subscribers per event
 */
export class EventBus {
  private listeners: Map<EventName, Set<EventHandler<EventName>>> = new Map();
  private onceListeners: Map<EventName, Set<EventHandler<EventName>>> =
    new Map();

  /**
   * Subscribe to an event
   * @param event Event name
   * @param handler Event handler
   * @returns Unsubscribe function
   */
  on<K extends EventName>(event: K, handler: EventHandler<K>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const handlers = this.listeners.get(event)!;
    handlers.add(handler as EventHandler<EventName>);

    logger.debug({ event }, 'Event handler registered');

    // Return unsubscribe function
    return () => {
      handlers.delete(handler as EventHandler<EventName>);
      logger.debug({ event }, 'Event handler unregistered');
    };
  }

  /**
   * Subscribe to an event once
   * Handler will be removed after first invocation
   * @param event Event name
   * @param handler Event handler
   * @returns Unsubscribe function
   */
  once<K extends EventName>(event: K, handler: EventHandler<K>): () => void {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set());
    }

    const handlers = this.onceListeners.get(event)!;
    handlers.add(handler as EventHandler<EventName>);

    logger.debug({ event }, 'One-time event handler registered');

    return () => {
      handlers.delete(handler as EventHandler<EventName>);
    };
  }

  /**
   * Remove a specific handler from an event
   * @param event Event name
   * @param handler Event handler to remove
   */
  off<K extends EventName>(event: K, handler: EventHandler<K>): void {
    const handlers = this.listeners.get(event);
    if (handlers !== undefined) {
      handlers.delete(handler as EventHandler<EventName>);
    }

    const onceHandlers = this.onceListeners.get(event);
    if (onceHandlers !== undefined) {
      onceHandlers.delete(handler as EventHandler<EventName>);
    }
  }

  /**
   * Remove all handlers for an event
   * @param event Event name (optional, if not provided removes all handlers)
   */
  removeAllListeners(event?: EventName): void {
    if (event !== undefined) {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
      logger.debug({ event }, 'All handlers removed for event');
    } else {
      this.listeners.clear();
      this.onceListeners.clear();
      logger.debug('All event handlers removed');
    }
  }

  /**
   * Emit an event to all subscribers
   * @param event Event name
   * @param payload Event payload
   */
  async emit<K extends EventName>(event: K, payload: EventMap[K]): Promise<void> {
    const handlers = this.listeners.get(event);
    const onceHandlers = this.onceListeners.get(event);

    const allHandlers: EventHandler<EventName>[] = [];

    if (handlers !== undefined) {
      allHandlers.push(...handlers);
    }

    if (onceHandlers !== undefined) {
      allHandlers.push(...onceHandlers);
      // Clear once handlers after collecting them
      this.onceListeners.delete(event);
    }

    if (allHandlers.length === 0) {
      return;
    }

    logger.debug(
      { event, listenerCount: allHandlers.length },
      'Emitting event'
    );

    // Execute all handlers concurrently
    const results = await Promise.allSettled(
      allHandlers.map((handler) => Promise.resolve(handler(payload)))
    );

    // Log any errors
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error(
          { event, error: result.reason },
          'Event handler threw an error'
        );
      }
    }
  }

  /**
   * Emit an event synchronously (fire and forget)
   * @param event Event name
   * @param payload Event payload
   */
  emitSync<K extends EventName>(event: K, payload: EventMap[K]): void {
    void this.emit(event, payload).catch((err) => {
      logger.error({ err, event }, 'Unhandled error in emitSync event handler');
    });
  }

  /**
   * Get the number of listeners for an event
   * @param event Event name
   */
  listenerCount(event: EventName): number {
    const regular = this.listeners.get(event)?.size ?? 0;
    const once = this.onceListeners.get(event)?.size ?? 0;
    return regular + once;
  }

  /**
   * Check if an event has any listeners
   * @param event Event name
   */
  hasListeners(event: EventName): boolean {
    return this.listenerCount(event) > 0;
  }

  /**
   * Get all registered event names
   */
  eventNames(): EventName[] {
    const names = new Set<EventName>();
    for (const event of this.listeners.keys()) {
      names.add(event);
    }
    for (const event of this.onceListeners.keys()) {
      names.add(event);
    }
    return Array.from(names);
  }
}

// Singleton instance for global event bus
let globalEventBus: EventBus | undefined;

/**
 * Get the global event bus instance
 */
export function getEventBus(): EventBus {
  if (globalEventBus === undefined) {
    globalEventBus = new EventBus();
  }
  return globalEventBus;
}

/**
 * Reset the global event bus (for testing)
 */
export function resetEventBus(): void {
  if (globalEventBus !== undefined) {
    globalEventBus.removeAllListeners();
    globalEventBus = undefined;
  }
}
