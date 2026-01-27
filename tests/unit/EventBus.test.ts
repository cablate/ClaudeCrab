import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus, resetEventBus } from '../../src/core/EventBus.js';
import type { EventMap } from '../../src/types/events.js';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    resetEventBus();
    eventBus = new EventBus();
  });

  describe('on/emit', () => {
    it('should register and call event handler', async () => {
      const handler = vi.fn();
      eventBus.on('error', handler);

      const error = {
        name: 'TestError',
        message: 'Test',
        code: 'TEST',
        recoverable: true,
      } as EventMap['error'];

      await eventBus.emit('error', error);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(error);
    });

    it('should support multiple handlers for same event', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventBus.on('error', handler1);
      eventBus.on('error', handler2);

      const error = {
        name: 'TestError',
        message: 'Test',
        code: 'TEST',
        recoverable: true,
      } as EventMap['error'];

      await eventBus.emit('error', error);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should return unsubscribe function', async () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.on('error', handler);

      unsubscribe();

      const error = {
        name: 'TestError',
        message: 'Test',
        code: 'TEST',
        recoverable: true,
      } as EventMap['error'];

      await eventBus.emit('error', error);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('once', () => {
    it('should call handler only once', async () => {
      const handler = vi.fn();
      eventBus.once('error', handler);

      const error = {
        name: 'TestError',
        message: 'Test',
        code: 'TEST',
        recoverable: true,
      } as EventMap['error'];

      await eventBus.emit('error', error);
      await eventBus.emit('error', error);

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('off', () => {
    it('should remove specific handler', async () => {
      const handler = vi.fn();
      eventBus.on('error', handler);
      eventBus.off('error', handler);

      const error = {
        name: 'TestError',
        message: 'Test',
        code: 'TEST',
        recoverable: true,
      } as EventMap['error'];

      await eventBus.emit('error', error);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('removeAllListeners', () => {
    it('should remove all handlers for specific event', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventBus.on('error', handler1);
      eventBus.on('error', handler2);

      eventBus.removeAllListeners('error');

      const error = {
        name: 'TestError',
        message: 'Test',
        code: 'TEST',
        recoverable: true,
      } as EventMap['error'];

      await eventBus.emit('error', error);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should remove all handlers when no event specified', () => {
      const handler = vi.fn();
      eventBus.on('error', handler);

      eventBus.removeAllListeners();

      expect(eventBus.listenerCount('error')).toBe(0);
    });
  });

  describe('listenerCount', () => {
    it('should return correct count', () => {
      expect(eventBus.listenerCount('error')).toBe(0);

      eventBus.on('error', vi.fn());
      expect(eventBus.listenerCount('error')).toBe(1);

      eventBus.once('error', vi.fn());
      expect(eventBus.listenerCount('error')).toBe(2);
    });
  });

  describe('hasListeners', () => {
    it('should return true when handlers exist', () => {
      expect(eventBus.hasListeners('error')).toBe(false);

      eventBus.on('error', vi.fn());
      expect(eventBus.hasListeners('error')).toBe(true);
    });
  });

  describe('eventNames', () => {
    it('should return all registered event names', () => {
      eventBus.on('error', vi.fn());
      eventBus.on('agent:loaded', vi.fn());

      const names = eventBus.eventNames();
      expect(names).toContain('error');
      expect(names).toContain('agent:loaded');
    });
  });

  describe('error handling', () => {
    it('should continue executing other handlers when one throws', async () => {
      const handler1 = vi.fn().mockRejectedValue(new Error('Handler error'));
      const handler2 = vi.fn();

      eventBus.on('error', handler1);
      eventBus.on('error', handler2);

      const error = {
        name: 'TestError',
        message: 'Test',
        code: 'TEST',
        recoverable: true,
      } as EventMap['error'];

      await eventBus.emit('error', error);

      expect(handler2).toHaveBeenCalled();
    });
  });
});
