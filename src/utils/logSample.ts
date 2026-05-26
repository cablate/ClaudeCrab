/**
 * High-frequency log sampling / throttling helpers.
 *
 * Use these for events that fire thousands of times per hour (schedule ticks,
 * keep-alive pings, polling heartbeats). They prevent log file explosion
 * without losing visibility entirely.
 *
 * Usage:
 *   sampled('schedule.tick', 10, () => logger.debug({...}, 'tick'));  // every 10th
 *   throttled('tg.typing', 5000, () => logger.debug({...}, 'typing')); // at most once / 5s
 */

const counters = new Map<string, number>();
const lastEmitted = new Map<string, number>();

/**
 * Count-based sampler. Emits every Nth call for the given key.
 * First call (count=1) DOES emit so startup signals aren't hidden.
 */
export const sampled = (key: string, every: number, fn: () => void): void => {
  if (every <= 1) {
    fn();
    return;
  }
  const next = (counters.get(key) ?? 0) + 1;
  counters.set(key, next);
  if (next === 1 || next % every === 0) fn();
};

/**
 * Time-window throttler. Emits at most once per windowMs for the given key.
 * First call in a fresh window emits immediately.
 */
export const throttled = (key: string, windowMs: number, fn: () => void): void => {
  const now = Date.now();
  const prev = lastEmitted.get(key) ?? 0;
  if (now - prev >= windowMs) {
    lastEmitted.set(key, now);
    fn();
  }
};

/** Test/reset hook. */
export const __resetLogSampleCounters = (): void => {
  counters.clear();
  lastEmitted.clear();
};
