import { TestBed } from '@angular/core/testing';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { HistoryImportStateService, historyImportCooldownAt } from './history-import-state.service';

describe('HistoryImportStateService', () => {
  afterEach(() => vi.useRealTimers());

  it('locks synchronously, shares completion with new observers, and isolates owner/provider/domain', () => {
    const service = TestBed.inject(HistoryImportStateService);
    const key = service.key('owner', 'COROS', 'activity');
    const operation = service.begin(key)!;
    expect(service.begin(key)).toBeNull();
    for (const other of [service.key('other', 'COROS', 'activity'), service.key('owner', 'Suunto', 'activity'), service.key('owner', 'COROS', 'sleep')]) {
      expect(service.begin(other)).not.toBeNull();
    }
    service.finish(key, operation, { status: 'success', result: { count: 11 } });
    let state: unknown;
    service.watch$(key).subscribe(value => state = value).unsubscribe();
    expect(state).toEqual({ status: 'success', result: { count: 11 } });
    expect(service.begin(key)).toBeNull();
  });

  it('retains cooldowns and fences an obsolete completion after expiration and retry', () => {
    vi.useFakeTimers();
    const service = TestBed.inject(HistoryImportStateService);
    const key = service.key('owner', 'COROS', 'sleep');
    const operation = service.begin(key)!;
    service.finish(key, operation, { status: 'cooldown', nextAllowedAtMs: Date.now() + 1000 });
    expect(service.begin(key)).toBeNull();
    vi.advanceTimersByTime(1000);
    const retry = service.begin(key)!;
    service.finish(key, operation, { status: 'error' });
    expect(service.begin(key)).toBeNull();
    service.finish(key, retry, { status: 'error' });
    expect(service.begin(key)).not.toBeNull();
  });

  it('retains contention without treating it as success and enables retry at the exact local deadline', () => {
    vi.useFakeTimers();
    const service = TestBed.inject(HistoryImportStateService);
    const key = service.key('owner', 'Garmin', 'activity');
    const operation = service.begin(key)!;
    service.finish(key, operation, { status: 'running', retryAllowedAtMs: Date.now() + 5_000 });
    expect(service.begin(key)).toBeNull();
    vi.advanceTimersByTime(5_000);
    expect(service.begin(key)).not.toBeNull();
  });

  it.each(['activity', 'sleep'] as const)('recognizes only the exact %s cooldown contract', domain => {
    const code = domain === 'activity' ? 'permission-denied' : 'resource-exhausted';
    const prefix = domain === 'activity' ? 'History import is not allowed until ' : 'Sleep backfill is not allowed until ';
    const date = '2026-10-16T06:54:05.536Z';
    for (const accepted of [code, `functions/${code}`]) {
      expect(historyImportCooldownAt({ code: accepted, message: prefix + date }, domain)).toBe(Date.parse(date));
    }
    for (const error of [null, { code, message: 'Permission denied' }, { code: 'unavailable', message: prefix + date },
      { code, message: prefix + 'bad date' }, { code, message: prefix + '2026-02-30T06:54:05.536Z' },
      { code, message: prefix + date + ' extra' }]) {
      expect(historyImportCooldownAt(error, domain)).toBeNull();
    }
  });

  it.each(['permission-denied', 'functions/permission-denied'])('recognizes the existing Garmin activity cooldown for %s', code => {
    const date = '2026-11-08T06:54:05.536Z';
    const message = `History import cannot happen before ${date}`;
    expect(historyImportCooldownAt({ code, message }, 'activity')).toBe(Date.parse(date));
    expect(historyImportCooldownAt({ code, message }, 'sleep')).toBeNull();
    expect(historyImportCooldownAt({ code, message: message + ' extra' }, 'activity')).toBeNull();
    expect(historyImportCooldownAt({ code: 'functions/internal', message }, 'activity')).toBeNull();
  });
});
