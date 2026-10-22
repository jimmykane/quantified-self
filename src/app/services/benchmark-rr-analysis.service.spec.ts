import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeRRIntervals } from '@sports-alliance/sports-lib';
import { BenchmarkRRAnalysisService } from './benchmark-rr-analysis.service';

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(public url: URL, public options: WorkerOptions) { MockWorker.instances.push(this); }
}

const input = { samples: [{ time: 800, interval: 800 }], durationMs: 1000 };

describe('BenchmarkRRAnalysisService', () => {
  let service: BenchmarkRRAnalysisService;
  beforeEach(() => {
    vi.useFakeTimers();
    MockWorker.instances = [];
    vi.stubGlobal('Worker', MockWorker);
    service = new BenchmarkRRAnalysisService();
  });
  afterEach(() => {
    service.ngOnDestroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('posts the original timing to a module worker and releases it on success', async () => {
    const analysis = analyzeRRIntervals(input.samples, input.durationMs);
    const result = service.analyze(input);
    const worker = MockWorker.instances[0];
    expect(worker.url.pathname).toContain('/workers/benchmark-rr.worker');
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith(input);
    worker.onmessage!({ data: { analysis } });
    await expect(result).resolves.toEqual(analysis);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a superseded request and ignores late responses from its worker', async () => {
    const first = service.analyze(input).catch(error => error);
    const oldWorker = MockWorker.instances[0];
    const second = service.analyze(input);
    const worker = MockWorker.instances[1];
    expect(await first).toMatchObject({ name: 'AbortError' });
    expect(oldWorker.terminate).toHaveBeenCalledOnce();
    oldWorker.onmessage!({ data: { error: 'Stale result' } });
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.onmessage!({ data: { analysis: null } });
    await expect(second).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['onerror', 'onmessageerror'] as const)('releases a worker after %s', async handler => {
    const result = service.analyze(input);
    const worker = MockWorker.instances[0];
    worker[handler]!();
    await expect(result).rejects.toThrow('calculation failed');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('surfaces a calculation error without retaining the input or worker', async () => {
    const result = service.analyze(input);
    const worker = MockWorker.instances[0];
    worker.onmessage!({ data: { error: 'The recorded interval timing could not be analyzed.' } });
    await expect(result).rejects.toThrow('could not be analyzed');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('terminates a hung worker at the time limit', async () => {
    const result = service.analyze(input).catch(error => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ message: expect.stringContaining('took too long') });
    expect(MockWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases resources when posting to the worker fails', async () => {
    class BrokenWorker extends MockWorker {
      override postMessage = vi.fn(() => { throw new Error('Cannot clone'); });
    }
    vi.stubGlobal('Worker', BrokenWorker);
    await expect(service.analyze(input)).rejects.toThrow('could not be started');
    expect(MockWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports an unsupported browser without constructing a worker', async () => {
    vi.stubGlobal('Worker', undefined);
    await expect(service.analyze(input)).rejects.toThrow('Summary statistics remain available');
    expect(MockWorker.instances).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an outstanding calculation when its component provider is destroyed', async () => {
    const result = service.analyze(input).catch(error => error);
    service.ngOnDestroy();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(MockWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
