import { isStyleReady, MapboxLikeMap, runWhenStyleReady } from './mapbox-style-ready.utils';

export interface TerrainToggleRequest {
  enable: boolean;
  animate: boolean;
}

export interface DeferredTerrainToggleState {
  pendingRequest: TerrainToggleRequest | null;
  cleanup?: () => void;
}

export interface ApplyTerrainOptions {
  sourceId?: string;
  sourceUrl?: string;
  exaggeration?: number;
  tileSize?: number;
  maxzoom?: number;
  pitchOnEnable?: number;
  pitchOnDisable?: number;
}

const DEFAULT_OPTIONS: Required<ApplyTerrainOptions> = {
  sourceId: 'mapbox-dem',
  sourceUrl: 'mapbox://mapbox.mapbox-terrain-dem-v1',
  exaggeration: 1.5,
  tileSize: 512,
  maxzoom: 14,
  pitchOnEnable: 60,
  pitchOnDisable: 0,
};

const TERRAIN_READY_EVENTS = ['style.load', 'styledata', 'load', 'idle'];

export function applyTerrain(
  map: MapboxLikeMap | null | undefined,
  enable: boolean,
  animate: boolean = true,
  options: ApplyTerrainOptions = {}
): void {
  if (!map) return;

  const resolved = { ...DEFAULT_OPTIONS, ...options };
  if (enable) {
    if (!map.getSource?.(resolved.sourceId)) {
      map.addSource?.(resolved.sourceId, {
        type: 'raster-dem',
        url: resolved.sourceUrl,
        tileSize: resolved.tileSize,
        maxzoom: resolved.maxzoom,
      });
    }
    map.setTerrain?.({ source: resolved.sourceId, exaggeration: resolved.exaggeration });
    if (animate) {
      map.easeTo?.({ pitch: resolved.pitchOnEnable });
    } else {
      map.setPitch?.(resolved.pitchOnEnable);
    }
    return;
  }

  map.setTerrain?.(null);
  if (animate) {
    map.easeTo?.({ pitch: resolved.pitchOnDisable });
  } else {
    map.setPitch?.(resolved.pitchOnDisable);
  }
}

export function deferTerrainToggleUntilReady(
  map: MapboxLikeMap | null | undefined,
  request: TerrainToggleRequest,
  state: DeferredTerrainToggleState,
  applyPending: (request: TerrainToggleRequest) => void
): void {
  state.pendingRequest = request;
  if (!map) return;

  if (isStyleReady(map)) {
    const pending = state.pendingRequest;
    clearDeferredTerrainToggleState(state);
    if (pending) {
      applyPending(pending);
    }
    return;
  }

  if (state.cleanup) {
    return;
  }

  state.cleanup = runWhenStyleReady(map, () => {
    const pending = state.pendingRequest;
    clearDeferredTerrainToggleState(state);
    if (pending) {
      applyPending(pending);
    }
  }, {
    events: TERRAIN_READY_EVENTS,
    runImmediately: false,
  });
}

export function clearDeferredTerrainToggleState(state: DeferredTerrainToggleState): void {
  state.pendingRequest = null;
  if (state.cleanup) {
    state.cleanup();
  }
  state.cleanup = undefined;
}
