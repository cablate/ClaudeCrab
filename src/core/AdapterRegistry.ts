import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import { logger } from '../utils/logger.js';

/**
 * Generate adapter registry key from platform and agentId
 */
function adapterKey(platform: string, agentId: string): string {
  return `${platform}::${agentId}`;
}

/**
 * Registry for managing platform adapters
 * Uses composite key (platform::agentId) to support multiple adapters per platform
 */
export class AdapterRegistry {
  private readonly adapters: Map<string, BaseAdapter> = new Map();

  /**
   * Register an adapter
   */
  register(adapter: BaseAdapter): void {
    const key = adapterKey(adapter.platform, adapter.agentId);
    if (this.adapters.has(key)) {
      throw new Error(`Adapter already registered for ${key}`);
    }

    this.adapters.set(key, adapter);
    logger.info({ platform: adapter.platform, agentId: adapter.agentId }, 'Adapter registered');
  }

  /**
   * Unregister an adapter
   */
  unregister(platform: string, agentId: string): boolean {
    const key = adapterKey(platform, agentId);
    const adapter = this.adapters.get(key);
    if (adapter === undefined) {
      return false;
    }

    this.adapters.delete(key);
    logger.info({ platform, agentId }, 'Adapter unregistered');
    return true;
  }

  /**
   * Get an adapter by platform and agentId
   */
  get(platform: string, agentId: string): BaseAdapter | undefined {
    return this.adapters.get(adapterKey(platform, agentId));
  }

  /**
   * Check if an adapter is registered
   */
  has(platform: string, agentId: string): boolean {
    return this.adapters.has(adapterKey(platform, agentId));
  }

  /**
   * Get all registered keys (platform::agentId)
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
