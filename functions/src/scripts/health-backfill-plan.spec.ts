import { describe, expect, it } from 'vitest';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { generateIDFromParts } from '../shared/id-generator';
import {
  buildHealthBackfillJobs, DAY_MS, earliestBackfillStart, observeBackfillJob, parseBackfillOptions,
} from './health-backfill-plan';

const now = Date.parse('2026-09-07T10:00:00Z');
const args = ['--project', 'test-project', '--provider', 'all', '--end', '2026-09-06'];
describe('existing-user Health backfill planning', () => {
  it('defaults to a bounded dry run with a stable inclusive end', () => {
    expect(parseBackfillOptions(args, now)).toMatchObject({ execute: false, maxUsers: 5, maxJobs: 25, endMs: Date.parse('2026-09-06T23:59:59Z') });
  });
  it.each([
    ['--execute'], ['--typo'], ['--max-jobs', '0'], ['--max-users', '1garbage'],
    ['--execute=false'], ['--uid', 'a/b'], ['--scan-limit', '10001'], ['--max-jobs'],
    ['--provider', 'garmin'],
  ])('rejects unsafe/ambiguous flags %j', (...extra) => expect(() => parseBackfillOptions([...args, ...extra], now)).toThrow());
  it('requires explicit bulk confirmation or a single owner', () => {
    expect(parseBackfillOptions([...args, '--execute', '--confirm-all-users'], now).execute).toBe(true);
    expect(parseBackfillOptions([...args, '--execute', '--uid=owner'], now).uid).toBe('owner');
  });
  it('accepts a cooldown exception only for one owner/provider and an exact timestamp', () => {
    const base = ['--project=test-project', '--provider=garmin', '--end=2026-09-06'];
    const flag = '--override-cooldown-until=2026-10-07T11:43:17.638Z';
    expect(parseBackfillOptions([...base, '--uid=owner', flag], now).overrideCooldownUntilMs)
      .toBe(Date.parse('2026-10-07T11:43:17.638Z'));
    expect(() => parseBackfillOptions([...base, flag], now)).toThrow();
    expect(() => parseBackfillOptions([...args, '--uid=owner', flag], now)).toThrow();
    for (const value of ['invalid', '2026-10-07', '2026-02-30T00:00:00.000Z']) {
      expect(() => parseBackfillOptions([...base, '--uid=owner', `--override-cooldown-until=${value}`], now)).toThrow();
    }
  });
  it.each(['2026-02-30', '2026-09-07', '2026-09-08'])('rejects invalid or incomplete end days %s', end => {
    expect(() => parseBackfillOptions(['--project=test-project', '--provider=garmin', `--end=${end}`], now)).toThrow();
  });
  it('rejects a reversed range and boundary expansion', () => {
    expect(() => parseBackfillOptions([...args, '--start=2026-09-07'], now)).toThrow();
    expect(() => parseBackfillOptions([...args, '--start=1999-12-31'], now)).toThrow();
    expect(parseBackfillOptions([...args, '--start=2000-01-01'], now).startMs).toBe(Date.parse('2000-01-01'));
  });
  it('creates one resumable all-family Garmin cursor, not Sleep HTTP calls', async () => {
    const jobs = buildHealthBackfillJobs(SLEEP_PROVIDERS.GarminAPI, 'uid', 'account', 1000, 2000, 'campaign');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].input).toMatchObject({ type: 'garmin_health_backfill', healthTrigger: 'backfill', dispatchImmediately: false, garminHealthBackfillWindowsTotal: 10 });
    expect(jobs[0].queueId).toBe(await generateIDFromParts([SLEEP_PROVIDERS.GarminAPI, 'garmin_health_backfill', 'account', jobs[0].input.dedupeKey!]));
  });
  it('uses bounded recent-first Suunto windows without a gap', () => {
    const jobs = buildHealthBackfillJobs(SLEEP_PROVIDERS.SuuntoApp, 'uid', 'account', 0, 60 * DAY_MS, 'campaign');
    expect(jobs).toHaveLength(3);
    expect(jobs[0].input.rangeEndMs).toBe(60 * DAY_MS);
    expect(jobs[2].input.rangeStartMs).toBe(0);
    expect(jobs[1].input.rangeEndMs).toBe(jobs[0].input.rangeStartMs);
    expect(jobs.every(j => j.input.type === 'suunto_health_poll')).toBe(true);
  });
  it('keeps shared accounts independent and IDs opaque', () => {
    const a = buildHealthBackfillJobs(SLEEP_PROVIDERS.SuuntoApp, 'uid-a', 'account', 0, DAY_MS, 'campaign')[0];
    const b = buildHealthBackfillJobs(SLEEP_PROVIDERS.SuuntoApp, 'uid-b', 'account', 0, DAY_MS, 'campaign')[0];
    expect(a.queueId).not.toBe(b.queueId);
    expect(a.key).toMatch(/^[a-f0-9]{64}$/);
    expect(a.input.dedupeKey).not.toContain('account');
  });
  it('clamps COROS against current retention, not the requested historical end', () => {
    expect(earliestBackfillStart(SLEEP_PROVIDERS.COROSAPI, 0, now)).toBe(Date.parse('2026-06-07T10:00:00Z'));
    const jobs = buildHealthBackfillJobs(SLEEP_PROVIDERS.COROSAPI, 'uid', 'account', Date.parse('2026-07-01'), Date.parse('2026-09-01'), 'campaign');
    expect(jobs).toHaveLength(3);
    expect(jobs.every(j => j.input.type === 'coros_poll')).toBe(true);
  });
  it('clamps Garmin to five years from now, even for an older requested end date', () => {
    const start = earliestBackfillStart(SLEEP_PROVIDERS.GarminAPI, Date.parse('2000-01-01'), now + 123);
    expect(start).toBe(Date.parse('2021-09-07T10:00:01Z'));
    expect(buildHealthBackfillJobs(SLEEP_PROVIDERS.GarminAPI, 'uid', 'account', start, Date.parse('2020-01-01'), 'campaign')).toEqual([]);
    expect(earliestBackfillStart(SLEEP_PROVIDERS.GarminAPI, Date.parse('2026-01-01'), now)).toBe(Date.parse('2026-01-01'));
  });
  it('uses the 2000 Suunto boundary while retaining operator job and user caps', () => {
    const options = parseBackfillOptions(args, now);
    expect(options).toMatchObject({ startMs: Date.parse('2000-01-01'), maxJobs: 25, maxUsers: 5 });
    expect(earliestBackfillStart(SLEEP_PROVIDERS.SuuntoApp, 0, now)).toBe(Date.parse('2000-01-01'));
    const jobs = buildHealthBackfillJobs(SLEEP_PROVIDERS.SuuntoApp, 'uid', 'account', options.startMs, options.endMs, 'campaign');
    expect(jobs.length).toBeLessThan(512);
    expect(jobs.at(-1)?.input.rangeStartMs).toBe(Date.parse('2000-01-01'));
    expect(jobs.every(j => j.input.rangeEndMs! - j.input.rangeStartMs! <= 28 * DAY_MS)).toBe(true);
  });
  it('does not equate processed or missing queue rows with success', () => {
    expect(observeBackfillJob(undefined, undefined, false, now)).toBe('new');
    expect(observeBackfillJob({ submittedAtMs: now - 10 * DAY_MS }, undefined, false, now)).toBe('unknown');
    expect(observeBackfillJob({ observation: 'success', submittedAtMs: 1 }, undefined, false, now)).toBe('success');
    expect(observeBackfillJob(undefined, { processed: true }, false, now)).toBe('unknown');
    expect(observeBackfillJob(undefined, { processed: true, resultStatus: 'success' }, false, now)).toBe('success');
    expect(observeBackfillJob(undefined, { processed: true, resultStatus: 'skipped' }, false, now)).toBe('skipped');
    expect(observeBackfillJob(undefined, { processed: false }, false, now)).toBe('pending');
    expect(observeBackfillJob(undefined, undefined, true, now)).toBe('failed');
  });
  it('only retries a recent ambiguous reservation', () => {
    expect(observeBackfillJob({ reservedAtMs: now - 1000 }, undefined, false, now)).toBe('reserved');
    expect(observeBackfillJob({ reservedAtMs: now - 2 * DAY_MS }, undefined, false, now)).toBe('unknown');
  });
});
