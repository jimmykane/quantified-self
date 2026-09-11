import type { ActivitySampleDataset } from './activity-samples.service';

export const ACTIVITY_SAMPLE_CACHE_LIMITS = Object.freeze({
  entries: 8, bytes: 24 * 1024 * 1024, entryBytes: 12 * 1024 * 1024,
  ttlMs: 120_000, pending: 2,
});
interface Entry { data: ActivitySampleDataset; bytes: number; expires: number; timer: NodeJS.Timeout }
export class ActivitySampleCacheBusyError extends Error {}

/** Process-local optimization only. Cursors never depend on this cache surviving. */
export class ActivitySampleCache {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<ActivitySampleDataset>>();
  private bytes = 0;
  private epoch = 0;
  constructor(private readonly now: () => number = Date.now) {}

  clear(): void {
    this.epoch++;
    for (const key of this.entries.keys()) this.remove(key);
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.bytes -= entry.bytes;
    this.entries.delete(key);
  }

  async load(key: string, build: () => Promise<ActivitySampleDataset>): Promise<ActivitySampleDataset> {
    for (const [oldKey, entry] of this.entries) if (entry.expires <= this.now()) this.remove(oldKey);
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.data;
    }
    const running = this.pending.get(key);
    if (running) return running;
    if (this.pending.size >= ACTIVITY_SAMPLE_CACHE_LIMITS.pending) {
      throw new ActivitySampleCacheBusyError('Activity sample parsing is busy. Retry later.');
    }
    const epoch = this.epoch;
    const promise = Promise.resolve().then(build).then(data => {
      const slots = data.series.reduce((sum, series) => sum + series.values.length, 0);
      // Account for both serialized size and JS array/value overhead, not just wire bytes.
      const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8') + slots * 24;
      if (epoch === this.epoch && bytes <= ACTIVITY_SAMPLE_CACHE_LIMITS.entryBytes) {
        while (this.entries.size && (this.entries.size >= ACTIVITY_SAMPLE_CACHE_LIMITS.entries
          || this.bytes + bytes > ACTIVITY_SAMPLE_CACHE_LIMITS.bytes)) {
          this.remove(this.entries.keys().next().value!);
        }
        const timer = setTimeout(() => this.remove(key), ACTIVITY_SAMPLE_CACHE_LIMITS.ttlMs);
        timer.unref();
        this.entries.set(key, { data, bytes, expires: this.now() + ACTIVITY_SAMPLE_CACHE_LIMITS.ttlMs, timer });
        this.bytes += bytes;
      }
      return data;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
}
