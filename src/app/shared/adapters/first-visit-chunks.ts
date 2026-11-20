// The first page can load a feature before Angular's worker controls the tab.
// Replay just those hashed scripts through the worker, using the browser cache.
export function cacheFirstVisitChunks(): void {
  let worker: ServiceWorkerContainer;
  try { worker = navigator.serviceWorker; }
  catch { return; } // Storage-restricted frames can reject service worker access.
  if (!worker || worker.controller || !globalThis.PerformanceObserver?.supportedEntryTypes?.includes('resource')) return;

  let controlledAt = Infinity;
  let handoff = Promise.resolve();
  const seen = new Set<string>();
  const cache = (url: string) => {
    handoff = handoff.then(async () => {
      try { await fetch(url, { cache: 'force-cache' }); }
      catch { /* A later controlled visit can retry when connectivity returns. */ }
    });
  };
  const observer = new PerformanceObserver(list => {
    for (const { name, startTime } of list.getEntries()) {
      if (startTime >= controlledAt || seen.has(name) || !name.startsWith(location.origin + '/')) continue;
      if (!/^\/(?:chunk|worker)-[A-Z0-9]{8}\.js$/.test(name.slice(location.origin.length))) continue;
      seen.add(name);
      if (controlledAt !== Infinity) cache(name);
    }
  });
  observer.observe({ type: 'resource', buffered: true });
  worker.addEventListener('controllerchange', () => {
    if (!worker.controller) return;
    controlledAt = performance.now();
    for (const url of seen) cache(url);
    // Timing entries appear on completion. An in-flight import can finish after control changes.
  }, { once: true });
}
