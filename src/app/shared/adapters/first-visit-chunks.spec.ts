import { afterEach, expect, it, vi } from 'vitest';
import { cacheFirstVisitChunks } from './first-visit-chunks';

afterEach(() => vi.unstubAllGlobals());

it('hands off only same-origin hashed scripts started before first control, including late completions', async () => {
  const origin = 'https://example.test';
  const worker = Object.assign(new EventTarget(), { controller: null as object | null });
  let deliver!: (entries: { name: string; startTime: number }[]) => void;
  class Observer {
    static supportedEntryTypes = ['resource'];
    constructor(callback: (list: { getEntries: () => unknown[] }) => void) {
      deliver = entries => callback({ getEntries: () => entries });
    }
    observe() {}
  }
  const fetch = vi.fn().mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValue({});
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('PerformanceObserver', Observer);
  vi.stubGlobal('navigator', { serviceWorker: worker });
  vi.stubGlobal('location', { origin });
  cacheFirstVisitChunks();
  const a = origin + '/chunk-1234ABCD.js';
  const b = origin + '/worker-ABCDEFGH.js';
  deliver([a, a, a + '?key=1', origin + '/api', 'https://other.test/chunk-1234ABCD.js']
    .map(name => ({ name, startTime: 0 })));
  expect(fetch).not.toHaveBeenCalled();
  worker.controller = {};
  worker.dispatchEvent(new Event('controllerchange'));
  deliver([{ name: a, startTime: 0 }, { name: b, startTime: 0 }, { name: origin + '/chunk-ABCDEF12.js', startTime: Infinity }]);
  await vi.waitFor(() => expect(fetch.mock.calls).toEqual([[a, { cache: 'force-cache' }], [b, { cache: 'force-cache' }]]));
});

it('leaves a controlled visit to Angular’s worker', () => {
  vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
  const observer = vi.fn();
  vi.stubGlobal('PerformanceObserver', observer);
  cacheFirstVisitChunks();
  expect(observer).not.toHaveBeenCalled();
});
