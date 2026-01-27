import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import { logger } from '../utils/logger.js';

/**
 * Registry for managing platform adapters
 * Provides centralized control for adapter lifecycle
 */
export class AdapterRegistry {
  private readonly adapters: Map<string, BaseAdapter> = new Map();

  /**
   * Register an adapter
   */
  register(adapter: BaseAdapter): void {
    if (this.adapters.has(adapter.platform)) {
      throw new Error(`Adapter already registered for platform: ${adapter.platform}`);
    }

    this.adapters.set(adapter.platform, adapter);
    logger.info({ platform: adapter.platform }, 'Adapter registered');
  }

  /**
   * Unregister an adapter
   */
  unregister(platform: string): boolean {
    const adapter = this.adapters.get(platform);
    if (adapter === undefined) {
      return false;
    }

    this.adapters.delete(platform);
    logger.info({ platform }, 'Adapter unregistered');
    return true;
  }

  /**
   * Get an adapter by platform
   */
  get(platform: string): BaseAdapter | undefined {
    return this.adapters.get(platform);
  }

  /**
   * Check if an adapter is registered
   */
  has(platform: string): boolean {
    return this.adapters.has(platform);
  }

  /**
   * Get all registered platforms
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
    logger.info({ count: adapters.length }, 'Initializing all adapters');

    const results = await Promise.allSettled(
      adapters.map((adapter) => adapter.initialize())
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      logger.error(
        { failedCount: failed.length },
        'Some adapters failed to initialize'
      );
    }
  }

  /**
   * Start all adapters
   */
  async startAll(): Promise<void> {
    const adapters = this.getAll();
    logger.info({ count: adapters.length }, 'Starting all adapters');

    const results = await Promise.allSettled(
      adapters.map((adapter) => adapter.start())
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      logger.error(
        { failedCount: failed.length },
        'Some adapters failed to start'
      );
      for (const result of failed) {
        if (result.status === 'rejected') {
          logger.error({ error: result.reason }, 'Adapter start error');
        }
      }
    }
  }

  /**
   * Stop all adapters
   */
  async stopAll(): Promise<void> {
    const adapters = this.getAll();
    logger.info({ count: adapters.length }, 'Stopping all adapters');

    const results = await Promise.allSettled(
      adapters.map((adapter) => adapter.stop())
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      logger.error(
        { failedCount: failed.length },
        'Some adapters failed to stop'
      );
    }
  }

  /**
   * Dispose all adapters and clear registry
   */
  async disposeAll(): Promise<void> {
    const adapters = this.getAll();
    logger.info({ count: adapters.length }, 'Disposing all adapters');

    const results = await Promise.allSettled(
      adapters.map((adapter) => adapter.dispose())
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      logger.error(
        { failedCount: failed.length },
        'Some adapters failed to dispose'
      );
    }

    this.adapters.clear();
    logger.info('All adapters disposed');
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
