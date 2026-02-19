import { describe, expect, it, vi } from 'vitest';
import {
  attachStyleReloadHandler,
  isStyleReady,
  runWhenStyleReady,
} from './mapbox-style-ready.utils';

function createMapMock() {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {};
  const map = {
    isStyleLoaded: vi.fn().mockReturnValue(false),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
    }),
    off: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = (handlers[event] || []).filter((candidate) => candidate !== handler);
    }),
  };

  const emit = (event: string, payload?: any) => {
    (handlers[event] || []).forEach((handler) => handler(payload));
  };

  return { map, handlers, emit };
}

describe('mapbox-style-ready.utils', () => {
  it('isStyleReady prefers map.isStyleLoaded when available', () => {
    const map = {
      isStyleLoaded: vi.fn().mockReturnValue(true),
      loaded: vi.fn().mockReturnValue(false),
    };
    expect(isStyleReady(map)).toBe(true);
    expect(map.isStyleLoaded).toHaveBeenCalled();
    expect(map.loaded).not.toHaveBeenCalled();
  });

  it('runWhenStyleReady waits for a ready event and cleans listeners', () => {
    const { map, handlers, emit } = createMapMock();
    const callback = vi.fn();

    const cleanup = runWhenStyleReady(map, callback, { runImmediately: false });
    expect(callback).not.toHaveBeenCalled();
    expect((handlers['style.load'] || []).length).toBe(1);

    map.isStyleLoaded.mockReturnValue(true);
    emit('style.load');

    expect(callback).toHaveBeenCalledTimes(1);
    expect((handlers['style.load'] || []).length).toBe(0);

    cleanup();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('attachStyleReloadHandler keeps one active handler per key', () => {
    const { map, emit } = createMapMock();
    const first = vi.fn();
    const second = vi.fn();

    const disposeFirst = attachStyleReloadHandler(map, first, 'tracks');
    const disposeSecond = attachStyleReloadHandler(map, second, 'tracks');

    emit('style.load');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(map.off).toHaveBeenCalledWith('style.load', first);

    disposeFirst();
    emit('style.load');
    expect(second).toHaveBeenCalledTimes(2);

    disposeSecond();
    emit('style.load');
    expect(second).toHaveBeenCalledTimes(2);
  });
});
