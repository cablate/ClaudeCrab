import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import { logger } from '../utils/logger.js';
import { EventType } from '../utils/events.js';

/**
 * Registry for managing Discord adapters.
 * Keyed by agentId because Discord is the only supported runtime platform.
 */
export class AdapterRegistry {
  private readonly adapters: Map<string, BaseAdapter> = new Map();

  /**
   * Register an adapter
   */
  register(adapter: BaseAdapter): void {
    const key = adapter.agentId;
    if (this.adapters.has(key)) {
      throw new Error(`Adapter already registered for ${key}`);
    }

    this.adapters.set(key, adapter);
    logger.info({ event_type: EventType.ADAPTER_INIT_COMPLETE, platform: adapter.platform, agentId: adapter.agentId }, 'Adapter registered');
  }

  /**
   * Unregister an adapter
   */
  unregister(agentId: string): boolean {
    const key = agentId;
    const adapter = this.adapters.get(key);
    if (adapter === undefined) {
      return false;
    }

    this.adapters.delete(key);
    logger.info({ event_type: EventType.ADAPTER_DISPOSE_COMPLETE, platform: adapter.platform, agentId }, 'Adapter unregistered');
    return true;
  }

  /**
   * Get a Discord adapter by agentId.
   */
  get(agentId: string): BaseAdapter | undefined {
    return this.adapters.get(agentId);
  }

  /**
   * Check if an adapter is registered
   */
  has(agentId: string): boolean {
    return this.adapters.has(agentId);
  }

  /**
   * Get all registered agent IDs.
   */
  list(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get all registered adapters
   */
  getAll(): BaseAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Initialize all adapters
   */
  async initializeAll(): Promise<void> {
    const adapters = this.getAll();
    logger.info({ event_type: EventType.ADAPTER_INIT_BEGIN, count: adapters.length }, 'Initializing all adapters');

    const results = await Promise.allSettled(
      adapters.map((adapter) => adapter.initialize())
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      logger.error(
        { event_type: EventType.ADAPTER_INIT_ERROR, failedCount: failed.length },
        'Some adapters failed to initialize'
      );
    }
  }

  /**
   * Start all adapters
   */
  async startAll(): Promise<void> {
    const adapters = this.getAll();
    logger.info({ event_type: EventType.ADAPTER_START_BEGIN, count: adapters.length }, 'Starting all adapters');

    const results = await Promise.allSettled(
      adapters.map((adapter) => adapter.start())
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      logger.error(
        { event_type: EventType.ADAPTER_START_ERROR, failedCount: failed.length },
        'Some adapters failed to start'
      );
      for (const result of failed) {
        if (result.status === 'rejected') {
          logger.error({ event_type: EventType.ADAPTER_START_ERROR, err: result.reason }, 'Adapter start error');
        }
      }
    }
  }

  /**
   * Stop all adapters
   */
  async stopAll(): Promise<void> {
    const adapters = this.getAll();
    logger.info({ event_type: EventType.ADAPTER_STOP_BEGIN, count: adapters.length }, 'Stopping all adapters');

    const results = await Promise.allSettled(
      adapters.map((adapter) => adapter.stop())
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      logger.error(
        { event_type: EventType.ADAPTER_STOP_ERROR, failedCount: failed.length },
        'Some adapters failed to stop'
      );
    }
  }

  /**
   * Dispose all adapters and clear registry
   */
  async disposeAll(): Promise<void> {
    const adapters = this.getAll();
    logger.info({ event_type: EventType.ADAPTER_DISPOSE_BEGIN, count: adapters.length }, 'Disposing all adapters');

    const results = await Promise.allSettled(
      adapters.map((adapter) => adapter.dispose())
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      logger.error(
        { event_type: EventType.ADAPTER_DISPOSE_ERROR, failedCount: failed.length },
        'Some adapters failed to dispose'
      );
    }

    this.adapters.clear();
    logger.info({ event_type: EventType.ADAPTER_DISPOSE_COMPLETE }, 'All adapters disposed');
  }

  /**
   * Get count of registered adapters
   */
  get size(): number {
    return this.adapters.size;
  }
}

/**
 * Global adapter registry instance
 */
let globalRegistry: AdapterRegistry | null = null;

/**
 * Get the global adapter registry
 */
export function getAdapterRegistry(): AdapterRegistry {
  if (globalRegistry === null) {
    globalRegistry = new AdapterRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global adapter registry (for testing)
 */
export function resetAdapterRegistry(): void {
  globalRegistry = null;
}
