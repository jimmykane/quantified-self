import { TestBed } from '@angular/core/testing';
import { LOCALE_ID, signal } from '@angular/core';
import { AppEventSummary } from '@shared/event-summary';
import { WeightUnits, ActivityTypes, FileType, Privacy } from '@sports-alliance/sports-lib';
import type { HealthSourceRecord } from '@shared/health';
import { projectLoadedHealthRange } from '@shared/health-query';
import type { EventInterface } from '@sports-alliance/sports-lib';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardTodayDataService } from './dashboard-today-data.service';
import { AppUserService } from './app.user.service';
import { ActivityCalendarService } from './activity-calendar.service';
import { HealthMetricQueryService } from './health-metric-query.service';
import { defaultDashboardTodaySettings } from '../helpers/dashboard-today-settings.helper';
import type { AppUserInterface, AppDashboardTodaySettings } from '../models/app-user.interface';

function healthReading(metricId: 'steps' | 'body_weight', value: number) {
  const timestamp = Date.parse(metricId === 'steps' ? '2026-11-10T10:00:00Z' : '2026-11-09T10:00:00Z');
  const unit = metricId === 'steps' ? 'count' : 'kg';
  const record: HealthSourceRecord = {
    schemaVersion: 1, id: 'reading', userID: 'owner', calendarDate: '2026-11-09',
    kind: metricId === 'steps' ? 'daily_summary' : 'point_measurement',
    startTimeMs: metricId === 'steps' ? timestamp - 86_400_000 : timestamp, endTimeMs: timestamp,
    source: { provider: 'GarminAPI', accountKey: 'account', sourceRecordType: 'reading', sourceRecordKey: 'reading',
      revision: { order: 1, token: 'revision', digest: 'digest' }, receivedAtMs: timestamp },
    metricIds: [metricId], metrics: [{ kind: 'value', metricId, valueType: 'number',
      aggregation: metricId === 'steps' ? 'total' : 'measurement', semanticVariant: 'recorded', origin: 'recorded',
      recordingMethod: 'device', quality: { status: 'valid' }, normalizationStatus: 'canonical',
      native: { metric: metricId, value, unit }, canonical: { value, unit } }],
    coverage: { status: 'complete' }, sampleChunkIds: [], createdAtMs: timestamp, updatedAtMs: timestamp,
  };
  return projectLoadedHealthRange([record], [], {
    startDate: '2026-11-09', endDate: '2026-11-09', metricIds: [metricId], includeSamples: false,
  }, { sourceRecordsComplete: true, samplesComplete: true });
}

describe('Today optional data', () => {
  const users = { user: signal<AppUserInterface | null>(null) };
  const calendar = { watchSummaryEvents: vi.fn() };
  const health = { invalidated$: new Subject<string>(), loadLatestMeasurement: vi.fn(), loadMetricRange: vi.fn() };
  let user: AppUserInterface;
  const settings = (metrics: AppDashboardTodaySettings['metrics']) => ({ ...defaultDashboardTodaySettings(), metrics });
  beforeEach(() => {
    vi.clearAllMocks(); user = { uid: 'owner', settings: { unitSettings: {}, summariesSettings: {}, appSettings: {} } } as AppUserInterface;
    users.user.set(user); calendar.watchSummaryEvents.mockReturnValue(of({ events: [], complete: true }));
    health.loadLatestMeasurement.mockResolvedValue({ results: [], complete: true });
    TestBed.configureTestingModule({ providers: [DashboardTodayDataService, { provide: AppUserService, useValue: users },
      { provide: ActivityCalendarService, useValue: calendar }, { provide: HealthMetricQueryService, useValue: health }] });
  });
  it('uses no optional reads for the starter layout and shares one local-day listener across activity metrics', () => {
    const service = TestBed.inject(DashboardTodayDataService);
    service.connect(user, defaultDashboardTodaySettings(), '2026-11-09');
    expect(calendar.watchSummaryEvents).not.toHaveBeenCalled(); expect(health.loadLatestMeasurement).not.toHaveBeenCalled();
    service.connect(user, settings(['tss', 'ascent', 'duration', 'activities']), '2026-11-09');
    service.connect(user, settings(['tss', 'ascent', 'duration', 'activities']), '2026-11-09');
    service.connect(user, settings(['activities', 'duration', 'ascent', 'tss', 'sleep']), '2026-11-09');
    expect(calendar.watchSummaryEvents).toHaveBeenCalledTimes(1);
    const window = calendar.watchSummaryEvents.mock.calls[0][1];
    expect(new Date(window.startMs).getHours()).toBe(0); expect(new Date(window.endExclusiveMs).getHours()).toBe(0);
    expect(service.metrics().activities.value).toBe('0');
  });
  it('tears down the activity listener and clears values immediately when the owner changes', () => {
    const stream = new Subject<{ events: []; complete: boolean }>(); calendar.watchSummaryEvents.mockReturnValue(stream);
    const service = TestBed.inject(DashboardTodayDataService);
    service.connect(user, settings(['activities']), '2026-11-09'); expect(stream.observed).toBe(true);
    users.user.set({ ...user, uid: 'other' }); service.connect(user, settings(['activities']), '2026-11-09');
    expect(stream.observed).toBe(false); expect(service.metrics()).toEqual({});
  });
  it('distinguishes a missing pinned weight source from a failed read', async () => {
    user.settings.appSettings.healthWorkspace = { metricSources: { body_weight: 'missing-source' } } as never;
    const service = TestBed.inject(DashboardTodayDataService);
    service.connect(user, settings(['weight']), '2026-11-09');
    await Promise.resolve(); await Promise.resolve();
    expect(service.metrics().weight).toMatchObject({ status: 'empty', detail: 'No weigh-in recorded for the selected source' });
    service.connect(user, settings([]), '2026-11-09');
    health.loadLatestMeasurement.mockRejectedValueOnce(new Error('Firestore unavailable'));
    service.connect(user, settings(['weight']), '2026-11-09');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(service.metrics().weight).toMatchObject({ status: 'error', detail: 'Unable to load weight' });
  });
  it('ignores an old Health result after the configured metric is removed', async () => {
    let resolve!: (value: { results: []; complete: boolean }) => void;
    health.loadLatestMeasurement.mockReturnValue(new Promise(done => { resolve = done; }));
    const service = TestBed.inject(DashboardTodayDataService);
    service.connect(user, settings(['weight']), '2026-11-09');
    expect(health.loadLatestMeasurement).toHaveBeenCalledTimes(1);
    service.connect(user, settings([]), '2026-11-09'); resolve({ results: [], complete: true });
    await Promise.resolve(); await Promise.resolve(); expect(service.metrics()).toEqual({});
  });
  it.each([
    ['en-GB', '9 Nov 2026'],
    ['en-US', 'Nov 9, 2026'],
  ])('keeps the Steps calendar date when the daily interval ends the next UTC day (%s)', async (locale, date) => {
    TestBed.overrideProvider(LOCALE_ID, { useValue: locale });
    health.loadMetricRange.mockResolvedValue({ result: healthReading('steps', 2000), limitReached: null });
    const service = TestBed.inject(DashboardTodayDataService);
    service.connect(user, settings(['steps']), '2026-11-09');
    await vi.waitFor(() => expect(service.metrics().steps?.status).toBe('ready'));
    expect(service.metrics().steps.detail).toBe(`Garmin · ${date}`);
  });
  it.each([
    [WeightUnits.Kilograms, '70.0 kg'],
    [WeightUnits.Pounds, '154.3 lb'],
  ])('renders actual weight in the account’s %s units', async (weightUnits, value) => {
    user.settings.unitSettings.weightUnits = weightUnits;
    health.loadLatestMeasurement.mockResolvedValue({ results: [healthReading('body_weight', 70)], complete: true });
    const service = TestBed.inject(DashboardTodayDataService);
    service.connect(user, settings(['weight']), '2026-11-09');
    await vi.waitFor(() => expect(service.metrics().weight?.status).toBe('ready'));
    expect(service.metrics().weight.value).toBe(value);
    expect(service.metrics().weight.hasData).toBe(true);
  });
  it('shares the opt-in rows and totals query, preserves partial evidence, and removes rows when disabled', () => {
    const service = TestBed.inject(DashboardTodayDataService);
    const stream = new Subject<{ events: EventInterface[]; complete: boolean }>();
    calendar.watchSummaryEvents.mockReturnValue(stream);
    const config = { ...settings(['activities', 'tss']), recordedActivities: true };
    service.connect(user, config, '2026-11-09');
    expect(service.activities().status).toBe('loading');
    const ride = new AppEventSummary({ id: 'ride', name: 'Morning ride', description: null,
      startDate: new Date(2026, 10, 9, 8).getTime(), endDate: new Date(2026, 10, 9, 9).getTime(),
      srcFileType: FileType.FIT, privacy: Privacy.Private, isMerge: false,
      stats: { 'Activity Types': [ActivityTypes.Cycling], Duration: 3600, 'Training Stress Score': 50 } });
    // ActivityCalendarService owns this historical projection contract.
    stream.next({ events: [ride, ride] as unknown as EventInterface[], complete: false });
    expect(service.activities()).toMatchObject({ ownerUid: 'owner', date: '2026-11-09', status: 'ready', complete: false });
    expect(service.activities().rows).toHaveLength(1);
    expect(service.activities().rows[0]).toMatchObject({ name: 'Morning ride', duration: '1h' });
    expect(service.metrics().activities).toMatchObject({ value: '1', status: 'error' });
    service.connect(user, { ...config }, '2026-11-09');
    expect(calendar.watchSummaryEvents).toHaveBeenCalledTimes(1);
    service.connect(user, settings([]), '2026-11-09');
    expect(stream.observed).toBe(false); expect(service.activities().rows).toEqual([]);
    expect(service.retryActivities()).toBe(false);
  });
  it('supports activity rows alone, local-day rollover, read failure and an explicit activity-only retry', () => {
    const service = TestBed.inject(DashboardTodayDataService);
    const stream = new Subject<{ events: EventInterface[]; complete: boolean }>();
    calendar.watchSummaryEvents.mockReturnValueOnce(stream);
    const config = { ...settings(['weight']), recordedActivities: true };
    service.connect(user, config, '2026-11-09');
    stream.error(new Error('offline'));
    expect(service.activities().status).toBe('error');
    expect(service.retryActivities()).toBe(true);
    expect(health.loadLatestMeasurement).toHaveBeenCalledTimes(1);
    expect(service.activities()).toMatchObject({ status: 'ready', rows: [], complete: true });
    expect(service.retryActivities()).toBe(false);
    service.connect(user, { ...settings([]), recordedActivities: true }, '2026-11-10');
    expect(service.activities().date).toBe('2026-11-10');
    const bounds = calendar.watchSummaryEvents.mock.calls.at(-1)[1];
    expect(bounds.startMs).toBe(new Date(2026, 10, 10).getTime());
    expect(bounds.endExclusiveMs).toBe(new Date(2026, 10, 11).getTime());
    users.user.set({ ...user, uid: 'other' });
    service.connect(user, config, '2026-11-10');
    expect(service.activities()).toMatchObject({ status: 'idle', rows: [], ownerUid: null });
    expect(service.retryActivities()).toBe(false);
  });

});
