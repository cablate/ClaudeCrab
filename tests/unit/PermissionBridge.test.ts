import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermissionBridge } from '../../src/core/PermissionBridge.js';
import type { PermissionDecision } from '../../src/core/PermissionBridge.js';

describe('PermissionBridge', () => {
  let bridge: PermissionBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    bridge = new PermissionBridge(5_000); // 5s timeout for tests
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeSignal(): { signal: AbortSignal; abort: () => void } {
    const controller = new AbortController();
    return { signal: controller.signal, abort: () => controller.abort() };
  }

  describe('requestPermission', () => {
    it('should create a pending request and return requestId + promise', () => {
      const { signal } = makeSignal();
      const { requestId, promise } = bridge.requestPermission(
        'Bash',
        { command: 'ls' },
        { signal, toolUseID: 'tu_1' }
      );

      expect(requestId).toMatch(/^perm_\d+_\d+$/);
      expect(promise).toBeInstanceOf(Promise);
      expect(bridge.hasPending(requestId)).toBe(true);
      expect(bridge.pendingCount).toBe(1);
    });

    it('should generate unique requestIds for multiple requests', () => {
      const { signal } = makeSignal();
      const r1 = bridge.requestPermission('Bash', { command: 'ls' }, { signal, toolUseID: 'tu_1' });
      const r2 = bridge.requestPermission('Write', { path: '/tmp' }, { signal, toolUseID: 'tu_2' });

      expect(r1.requestId).not.toBe(r2.requestId);
      expect(bridge.pendingCount).toBe(2);
    });
  });

  describe('resolvePermission', () => {
    it('should resolve with allow when user approves', async () => {
      const { signal } = makeSignal();
      const { requestId, promise } = bridge.requestPermission(
        'Bash',
        { command: 'ls' },
        { signal, toolUseID: 'tu_1' }
      );

      const resolved = bridge.resolvePermission(requestId, { behavior: 'allow' });
      expect(resolved).toBe(true);

      const result = await promise;
      expect(result.behavior).toBe('allow');
      expect(bridge.hasPending(requestId)).toBe(false);
    });

    it('should resolve with deny when user denies', async () => {
      const { signal } = makeSignal();
      const { requestId, promise } = bridge.requestPermission(
        'Bash',
        { command: 'rm -rf /' },
        { signal, toolUseID: 'tu_1' }
      );

      bridge.resolvePermission(requestId, {
        behavior: 'deny',
        message: 'User denied permission',
      });

      const result = await promise;
      expect(result.behavior).toBe('deny');
      expect(result.message).toBe('User denied permission');
    });

    it('should return false for unknown requestId', () => {
      const result = bridge.resolvePermission('unknown_id', { behavior: 'allow' });
      expect(result).toBe(false);
    });

    it('should return false on second resolve (double-press safety)', async () => {
      const { signal } = makeSignal();
      const { requestId, promise } = bridge.requestPermission(
        'Bash',
        { command: 'ls' },
        { signal, toolUseID: 'tu_1' }
      );

      const first = bridge.resolvePermission(requestId, { behavior: 'allow' });
      const second = bridge.resolvePermission(requestId, { behavior: 'deny', message: 'late' });

      expect(first).toBe(true);
      expect(second).toBe(false);

      // Promise resolves with first decision
      const result = await promise;
      expect(result.behavior).toBe('allow');
    });
  });

  describe('timeout', () => {
    it('should auto-deny after timeout', async () => {
      const { signal } = makeSignal();
      const { requestId, promise } = bridge.requestPermission(
        'Bash',
        { command: 'dangerous' },
        { signal, toolUseID: 'tu_1' }
      );

      expect(bridge.hasPending(requestId)).toBe(true);

      // Advance time past timeout
      vi.advanceTimersByTime(5_001);

      const result = await promise;
      expect(result.behavior).toBe('deny');
      expect(result.message).toContain('timed out');
      expect(bridge.hasPending(requestId)).toBe(false);
    });

    it('should not fire timeout if resolved before', async () => {
      const { signal } = makeSignal();
      const { requestId, promise } = bridge.requestPermission(
        'Bash',
        { command: 'ls' },
        { signal, toolUseID: 'tu_1' }
      );

      bridge.resolvePermission(requestId, { behavior: 'allow' });

      // Advance past timeout — should not affect the already-resolved promise
      vi.advanceTimersByTime(6_000);

      const result = await promise;
      expect(result.behavior).toBe('allow');
    });
  });

  describe('AbortSignal', () => {
    it('should deny when signal is aborted', async () => {
      const { signal, abort } = makeSignal();
      const { promise } = bridge.requestPermission(
        'Bash',
        { command: 'ls' },
        { signal, toolUseID: 'tu_1' }
      );

      abort();

      const result = await promise;
      expect(result.behavior).toBe('deny');
      expect(result.message).toContain('aborted');
      expect(bridge.pendingCount).toBe(0);
    });

    it('should deny immediately if signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const { promise } = bridge.requestPermission(
        'Bash',
        { command: 'ls' },
        { signal: controller.signal, toolUseID: 'tu_1' }
      );

      const result = await promise;
      expect(result.behavior).toBe('deny');
      expect(result.message).toContain('aborted');
    });
  });

  describe('cancelAll', () => {
    it('should deny all pending requests', async () => {
      const { signal } = makeSignal();
      const r1 = bridge.requestPermission('Bash', { command: 'a' }, { signal, toolUseID: 'tu_1' });
      const r2 = bridge.requestPermission('Write', { path: 'b' }, { signal, toolUseID: 'tu_2' });
      const r3 = bridge.requestPermission('Edit', { file: 'c' }, { signal, toolUseID: 'tu_3' });

      expect(bridge.pendingCount).toBe(3);

      bridge.cancelAll();

      expect(bridge.pendingCount).toBe(0);

      const [d1, d2, d3] = await Promise.all([r1.promise, r2.promise, r3.promise]);
      expect(d1.behavior).toBe('deny');
      expect(d2.behavior).toBe('deny');
      expect(d3.behavior).toBe('deny');
      expect(d1.message).toContain('cancelled');
    });

    it('should be safe to call on empty bridge', () => {
      expect(() => bridge.cancelAll()).not.toThrow();
    });
  });

  describe('concurrent requests', () => {
    it('should handle multiple independent requests', async () => {
      const { signal } = makeSignal();
      const r1 = bridge.requestPermission('Bash', { command: 'ls' }, { signal, toolUseID: 'tu_1' });
      const r2 = bridge.requestPermission('Write', { path: '/tmp' }, { signal, toolUseID: 'tu_2' });

      // Resolve in reverse order
      bridge.resolvePermission(r2.requestId, { behavior: 'deny', message: 'no' });
      bridge.resolvePermission(r1.requestId, { behavior: 'allow' });

      const [d1, d2] = await Promise.all([r1.promise, r2.promise]);
      expect(d1.behavior).toBe('allow');
      expect(d2.behavior).toBe('deny');
    });
  });
});
