import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectLoadedHealthRange } from '@shared/health-query';
import type { HealthObservation } from '@shared/health';
import type { SleepSession } from '@shared/sleep';
import type { TimelineNote } from '@shared/timeline-notes';
import { HealthMetricQueryService } from './health-metric-query.service';
import { TimelineNoteComparisonService } from './timeline-note-comparison.service';
import { buildNoteComparisonRows } from '../helpers/timeline-note-comparison.helper';

const note = { startDate: '2026-09-30', timeZone: 'Europe/Helsinki' } as TimelineNote;
const now = Date.parse('2026-10-15T10:00:00Z');
describe('Timeline note comparison reads', () => {
  const queries = { isOwner: vi.fn(), loadMetricRange: vi.fn(), loadSleepSummaryRange: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks(); queries.isOwner.mockReturnValue(true);
    queries.loadMetricRange.mockImplementation(async (_uid, request) => ({ result: projectLoadedHealthRange([], [], { ...request, metricIds: [request.metricId] },
      { sourceRecordsComplete: true, samplesComplete: true }), limitReached: null }));
    queries.loadSleepSummaryRange.mockResolvedValue({ sessions: [], complete: true, limitReached: null });
    TestBed.configureTestingModule({ providers: [{ provide: HealthMetricQueryService, useValue: queries }] });
  });
  it('loads one union window per metric and one native Sleep envelope, without samples or baseline history', async () => {
    const signal = new AbortController().signal;
    const evidence = await TestBed.inject(TimelineNoteComparisonService).load('owner', note, 14, signal, now);
    expect(queries.loadMetricRange.mock.calls.map(call => call[1])).toEqual([
      { metricId: 'heart_rate_variability', startDate: '2026-09-16', endDate: '2026-10-14', includeSamples: false },
      { metricId: 'resting_heart_rate', startDate: '2026-09-16', endDate: '2026-10-14', includeSamples: false },
    ]);
    expect(queries.loadSleepSummaryRange).toHaveBeenCalledExactlyOnceWith('owner', Date.parse('2026-09-15T00:00:00Z'), now, 100, signal);
    expect(evidence.complete).toEqual({ sleep_duration: true, heart_rate_variability: true, resting_heart_rate: true });
  });
  it('keeps failures and limits explicit, independently of the other surviving sources', async () => {
    queries.loadMetricRange.mockRejectedValueOnce(new Error('offline'));
    queries.loadSleepSummaryRange.mockResolvedValue({ sessions: [], complete: false, limitReached: 'records' });
    const value = await TestBed.inject(TimelineNoteComparisonService).load('owner', note, 14, new AbortController().signal, now);
    expect(value.complete).toEqual({ sleep_duration: false, heart_rate_variability: false, resting_heart_rate: true });
    expect(value.notices).toHaveLength(2);
  });
  it('reuses native main-night Sleep and canonical daily HR without substituting sleep HR or naps', async () => {
    const endTimeMs = Date.parse('2026-10-01T06:00:00Z');
    const session: SleepSession = { id: 'night', userID: 'owner', source: { provider: 'SuuntoApp', sourceSessionKey: 'night', providerUserId: 'fixture' },
      sleepDate: '2026-10-01', startTimeMs: endTimeMs - 28_800_000, endTimeMs, durationSeconds: 28_800,
      isNap: false, stages: [], stageDurationsSeconds: {}, vitals: { overnightHrvMs: 55, restingHeartRateBpm: 49 },
      createdAtMs: endTimeMs, updatedAtMs: endTimeMs };
    queries.loadSleepSummaryRange.mockResolvedValue({ sessions: [session, { ...session, id: 'nap', isNap: true, durationSeconds: 1800 }], complete: true, limitReached: null });
    queries.loadMetricRange.mockImplementation(async (_uid, request) => {
      const result = projectLoadedHealthRange([], [], { ...request, metricIds: [request.metricId] }, { sourceRecordsComplete: true, samplesComplete: true });
      if (request.metricId === 'resting_heart_rate') {
        result.observations.push({ id: 'daily', sourceRecordId: 'daily', sourceRevisionOrder: 1, provider: 'GarminAPI', accountKey: 'garmin',
          calendarDate: '2026-10-01', startTimeMs: endTimeMs, endTimeMs, sourceRecordType: 'daily', sourceRecordKey: 'opaque', receivedAtMs: endTimeMs,
          coverage: { status: 'complete' }, device: null, entry: { kind: 'value', metricId: 'resting_heart_rate', valueType: 'number', aggregation: 'average',
            semanticVariant: 'daily_resting', origin: 'provider_summary', recordingMethod: 'provider_calculated', quality: { status: 'valid' }, normalizationStatus: 'canonical',
            native: { metric: 'restingHeartRate', value: 64, unit: 'bpm' }, canonical: { value: 64, unit: 'bpm' } } } as HealthObservation);
      }
      return { result, limitReached: null };
    });
    const evidence = await TestBed.inject(TimelineNoteComparisonService).load('owner', note, 14, new AbortController().signal, now);
    const rows = buildNoteComparisonRows(evidence.series, evidence.window, evidence.complete);
    expect(rows.find(row => row.metricId === 'sleep_duration').dailySeries.points.map(point => point.value)).toEqual([28_800]);
    expect(evidence.series.filter(value => value.metricId === 'heart_rate_variability').flatMap(value => value.points.map(point => point.value))).toEqual([55]);
    expect(evidence.series.filter(value => value.metricId === 'resting_heart_rate').map(value => [value.provider, value.semanticVariant, value.points[0].value]))
      .toEqual([['GarminAPI', 'daily_resting', 64]]);
  });
  it('rejects private reads and late results after owner changes or cancellation', async () => {
    const service = TestBed.inject(TimelineNoteComparisonService);
    queries.isOwner.mockReturnValue(false);
    await expect(service.load('other', note, 14, new AbortController().signal, now)).rejects.toThrow('account changed');
    expect(queries.loadMetricRange).not.toHaveBeenCalled();
    queries.isOwner.mockReturnValue(true);
    const controller = new AbortController();
    queries.loadSleepSummaryRange.mockImplementation(async () => { controller.abort(); return { sessions: [], complete: true }; });
    await expect(service.load('owner', note, 14, controller.signal, now)).rejects.toThrow('view closed');
  });
  it('does not query wholly future windows and never requests future after-days', async () => {
    const service = TestBed.inject(TimelineNoteComparisonService);
    await service.load('owner', { ...note, startDate: '2027-01-01' }, 14, new AbortController().signal, now);
    expect(queries.loadMetricRange).not.toHaveBeenCalled();
    await service.load('owner', note, 28, new AbortController().signal, now);
    expect(queries.loadMetricRange.mock.calls.every(call => call[1].endDate === '2026-10-14')).toBe(true);
  });
});
