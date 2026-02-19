import { describe, expect, it, vi } from 'vitest';
import {
  applyTerrain,
  clearDeferredTerrainToggleState,
  deferTerrainToggleUntilReady,
  DeferredTerrainToggleState,
} from './mapbox-terrain.utils';

function createMapMock() {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {};
  const sources = new Map<string, any>();
  const map = {
    isStyleLoaded: vi.fn().mockReturnValue(false),
    getSource: vi.fn((sourceId: string) => sources.get(sourceId)),
    addSource: vi.fn((sourceId: string, source: any) => {
      sources.set(sourceId, source);
    }),
    setTerrain: vi.fn(),
    easeTo: vi.fn(),
    setPitch: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
    }),
    off: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = (handlers[event] || []).filter((candidate) => candidate !== handler);
    }),
  };

  const emit = (event: string) => {
    (handlers[event] || []).forEach((handler) => handler());
  };

  return { map, emit };
}

describe('mapbox-terrain.utils', () => {
  it('applyTerrain enables 3D terrain and sets pitch', () => {
    const { map } = createMapMock();
    applyTerrain(map, true, false);

    expect(map.addSource).toHaveBeenCalledWith('mapbox-dem', expect.objectContaining({
      type: 'raster-dem',
    }));
    expect(map.setTerrain).toHaveBeenCalledWith(expect.objectContaining({ source: 'mapbox-dem' }));
    expect(map.setPitch).toHaveBeenCalledWith(60);
  });

  it('applyTerrain disables terrain and resets pitch', () => {
    const { map } = createMapMock();
    applyTerrain(map, false, true);

    expect(map.setTerrain).toHaveBeenCalledWith(null);
    expect(map.easeTo).toHaveBeenCalledWith({ pitch: 0 });
  });

  it('deferTerrainToggleUntilReady applies latest pending request once ready', () => {
    const { map, emit } = createMapMock();
    const state: DeferredTerrainToggleState = { pendingRequest: null };
    const applyPending = vi.fn();

    deferTerrainToggleUntilReady(map, { enable: true, animate: false }, state, applyPending);
    deferTerrainToggleUntilReady(map, { enable: false, animate: true }, state, applyPending);

    expect(applyPending).not.toHaveBeenCalled();

    map.isStyleLoaded.mockReturnValue(true);
    emit('style.load');

    expect(applyPending).toHaveBeenCalledTimes(1);
    expect(applyPending).toHaveBeenCalledWith({ enable: false, animate: true });
    expect(state.pendingRequest).toBeNull();
    expect(state.cleanup).toBeUndefined();
  });

  it('clearDeferredTerrainToggleState removes listeners', () => {
    const { map } = createMapMock();
    const cleanup = vi.fn();
    const state: DeferredTerrainToggleState = {
      pendingRequest: { enable: true, animate: false },
      cleanup,
    };

    clearDeferredTerrainToggleState(state);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(state.pendingRequest).toBeNull();
    expect(state.cleanup).toBeUndefined();
  });
});
