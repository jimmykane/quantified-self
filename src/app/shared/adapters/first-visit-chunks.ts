// The first page can load a feature before Angular's worker controls the tab.
// Replay just those hashed scripts through the worker, using the browser cache.
export function cacheFirstVisitChunks(): void {
  let worker: ServiceWorkerContainer;
  try { worker = navigator.serviceWorker; }
  catch { return; } // Storage-restricted frames can reject service worker access.
  if (!worker || !globalThis.performance?.getEntriesByType) return;

  if (worker.controller) {
    // Another tab can claim this document between its initial navigation and bootstrap.
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navigation?.workerStart !== 0) return;
  }

  let controlledAt = Infinity;
  let handoff = Promise.resolve();
  const seen = new Set<string>();
  const cache = (url: string) => {
    handoff = handoff.then(async () => {
      try { await fetch(url, { cache: 'force-cache' }); }
      catch { /* A later controlled visit can retry when connectivity returns. */ }
    });
  };

  const remember = (entries: PerformanceEntryList) => {
    for (const entry of entries as PerformanceResourceTiming[]) {
      if (entry.startTime >= controlledAt || entry.workerStart > 0 || entry.responseStatus >= 400) continue;
      if (seen.has(entry.name)) continue;
      if (!entry.name.startsWith(location.origin + '/')) continue;
      if (!/^\/(?:chunk|worker)-[A-Z0-9]{8}\.js$/.test(entry.name.slice(location.origin.length))) continue;
      seen.add(entry.name);
      if (controlledAt !== Infinity) cache(entry.name);
    }
  };

  // Timing entries appear on completion, including for requests still in flight at first control.
  if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes('resource')) {
    try {
      new PerformanceObserver(list => remember(list.getEntries())).observe({ type: 'resource', buffered: true });
    } catch { /* Read completed resource timings at first control if buffered observation is unavailable. */ }
  }

  const onControl = () => {
    if (!worker.controller) return;
    worker.removeEventListener('controllerchange', onControl);
    controlledAt = performance.now();
    for (const url of seen) cache(url);
    remember(performance.getEntriesByType('resource'));
  };
  if (worker.controller) onControl();
  else worker.addEventListener('controllerchange', onControl);
}
