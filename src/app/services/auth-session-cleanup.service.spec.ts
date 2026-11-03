import { describe, it, expect, vi } from 'vitest';
import { AuthSessionCleanupService } from './auth-session-cleanup.service';
describe('bounded session cleanup', () => {
  it('runs registered cleanup and tolerates failure', async () => {
    const service = new AuthSessionCleanupService(); const good = vi.fn(async () => undefined);
    service.register(good); service.register(async () => { throw new Error('offline'); });
    await service.run(); expect(good).toHaveBeenCalledOnce();
  });
  it('unregisters callbacks and bounds offline cleanup', async () => {
    vi.useFakeTimers();
    try {
      const service = new AuthSessionCleanupService(); const removed = vi.fn(async () => undefined);
      service.register(removed)(); service.register(() => new Promise(() => undefined));
      const run = service.run(); await vi.advanceTimersByTimeAsync(2000); await run;
      expect(removed).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
