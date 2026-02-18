export interface MapboxLikeMap {
  on?: (event: string, ...args: any[]) => void;
  off?: (event: string, ...args: any[]) => void;
  once?: (event: string, ...args: any[]) => void;
  loaded?: () => boolean;
  isStyleLoaded?: () => boolean;
  getSource?: (sourceId: string) => any;
  addSource?: (sourceId: string, source: any) => void;
  removeSource?: (sourceId: string) => void;
  getLayer?: (layerId: string) => any;
  addLayer?: (layer: any, beforeLayerId?: string) => void;
  removeLayer?: (layerId: string) => void;
  setPaintProperty?: (layerId: string, property: string, value: any) => void;
  setLayoutProperty?: (layerId: string, property: string, value: any) => void;
  setTerrain?: (options: any) => void;
  easeTo?: (options: any) => void;
  setPitch?: (pitch: number) => void;
  getPitch?: () => number;
}

export interface RunWhenStyleReadyOptions {
  events?: string[];
  runImmediately?: boolean;
}

const DEFAULT_STYLE_READY_EVENTS = ['style.load', 'styledata', 'load', 'idle'];
const styleReloadHandlerRegistry = new WeakMap<object, Map<string, (...args: any[]) => void>>();

export function isStyleReady(map: MapboxLikeMap | null | undefined): boolean {
  if (!map) return false;
  if (typeof map.isStyleLoaded === 'function') {
    return map.isStyleLoaded();
  }
  if (typeof map.loaded === 'function') {
    return map.loaded();
  }
  return true;
}

export function runWhenStyleReady(
  map: MapboxLikeMap | null | undefined,
  callback: () => void,
  options: RunWhenStyleReadyOptions = {}
): () => void {
  if (!map) return () => undefined;

  const events = options.events?.length ? options.events : DEFAULT_STYLE_READY_EVENTS;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    events.forEach((event) => map.off?.(event, readyHandler));
  };

  const readyHandler = () => {
    if (!isStyleReady(map)) return;
    cleanup();
    callback();
  };

  events.forEach((event) => map.on?.(event, readyHandler));
  if (options.runImmediately !== false) {
    readyHandler();
  }

  return cleanup;
}

export function attachStyleReloadHandler(
  map: MapboxLikeMap | null | undefined,
  onStyleLoad: (...args: any[]) => void,
  key: string = 'default'
): () => void {
  if (!map?.on) {
    return () => undefined;
  }

  const mapObject = map as unknown as object;
  let handlersForMap = styleReloadHandlerRegistry.get(mapObject);
  if (!handlersForMap) {
    handlersForMap = new Map<string, (...args: any[]) => void>();
    styleReloadHandlerRegistry.set(mapObject, handlersForMap);
  }

  const existingHandler = handlersForMap.get(key);
  if (existingHandler) {
    map.off?.('style.load', existingHandler);
  }

  map.on('style.load', onStyleLoad);
  handlersForMap.set(key, onStyleLoad);

  return () => {
    const latestHandlersForMap = styleReloadHandlerRegistry.get(mapObject);
    const latestHandler = latestHandlersForMap?.get(key);
    if (latestHandler !== onStyleLoad) {
      return;
    }
    map.off?.('style.load', onStyleLoad);
    latestHandlersForMap?.delete(key);
    if (latestHandlersForMap && latestHandlersForMap.size === 0) {
      styleReloadHandlerRegistry.delete(mapObject);
    }
  };
}
