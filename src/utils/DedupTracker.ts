/**
 * DedupTracker — Unified deduplication mechanism with TTL support
 *
 * Provides a simple interface for tracking whether a key has been seen before,
 * with automatic cleanup of old entries based on TTL and max size.
 *
 * @example
 * ```typescript
 * const tracker = new DedupTracker({ maxSize: 1000, ttlMs: 60_000 });
 *
 * if (tracker.isDuplicate('msg-123')) {
 *   // Already processed, skip
 *   return;
 * }
 * // First time seeing this key, proceed with processing
 * ```
 */
export interface DedupTrackerOptions {
  /** Maximum number of entries to keep. Triggers cleanup when exceeded. */
  maxSize: number;
  /** TTL in milliseconds. Entries older than this are eligible for cleanup. Default: Infinity */
  ttlMs?: number;
}

export class DedupTracker {
  private entries = new Map<string, number>(); // key → timestamp
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(options: DedupTrackerOptions) {
    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs ?? Infinity;
  }

  /**
   * Check if a key is a duplicate (already seen).
   * If the key is new, it will be automatically recorded.
   *
   * @param key - The unique identifier to check
   * @returns `true` if the key was already seen (duplicate), `false` if new
   */
  isDuplicate(key: string): boolean {
    const now = Date.now();
    this.cleanup(now);

    if (this.entries.has(key)) {
      return true;
    }
    this.entries.set(key, now);
    return false;
  }

  /**
   * Check if a key exists without recording it.
   * Useful for read-only checks.
   *
   * @param key - The unique identifier to check
   * @returns `true` if the key exists, `false` otherwise
   */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  /**
   * Manually add a key without checking for duplicates.
   * Useful when you need to record a key unconditionally.
   *
   * @param key - The unique identifier to add
   */
  add(key: string): void {
    this.entries.set(key, Date.now());
  }

  /**
   * Remove a specific key from the tracker.
   *
   * @param key - The unique identifier to remove
   * @returns `true` if the key was removed, `false` if it didn't exist
   */
  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /**
   * Get the current number of tracked entries.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Clear all tracked entries.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Cleanup old entries when size exceeds maxSize.
   * Removes entries older than TTL first, then oldest entries if needed.
   */
  private cleanup(now: number): void {
    if (this.entries.size <= this.maxSize) {
      return;
    }

    // First pass: remove expired entries
    const toDelete: string[] = [];
    for (const [key, timestamp] of this.entries) {
      if (now - timestamp > this.ttlMs) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.entries.delete(key);
    }

    // If still over capacity, remove oldest entries until at half capacity
    if (this.entries.size > this.maxSize) {
      const targetSize = Math.floor(this.maxSize / 2);
      const sortedEntries = [...this.entries.entries()].sort((a, b) => a[1] - b[1]);
      const removeCount = this.entries.size - targetSize;

      for (let i = 0; i < removeCount && i < sortedEntries.length; i++) {
        const entry = sortedEntries[i];
        if (entry) {
          this.entries.delete(entry[0]);
        }
      }
    }
  }
}
