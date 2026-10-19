import { DistanceUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { formatCanonicalHealthMetricSportsLibValue } from '@shared/sports-lib-health-data';
import { describe, expect, it } from 'vitest';
import { HEALTH_METRIC_CATALOG, HealthMetricId, HealthSourceRecord } from '@shared/health';
import type { SleepSession } from '@shared/sleep';
import { projectLoadedHealthRange } from '@shared/health-query';
import { enrichSleepWithNightlyHrv, nightlyHealthAccountKey } from '@shared/nightly-hrv';
import { withHealthSleepAccountKeys } from './health-sleep-account.helper';
import { AppDashboardHealthMetricSettings } from '../models/app-user.interface';
import { buildDashboardHealthContext, filterDashboardHealthEvidence, DashboardHealthEvidence } from './dashboard-health-context.helper';
import { DASHBOARD_HEALTH_GROUPS } from './dashboard-health-tile.helper';
import { resolveHealthWorkspaceWindow, opaqueHealthSeriesId } from './health-workspace.helper';

function evidence(metric:HealthMetricId, accounts=['first'], range:AppDashboardHealthMetricSettings['range']='30d'):DashboardHealthEvidence {
  const definition=HEALTH_METRIC_CATALOG[metric]; const value=definition.valueType==='category' ? 'rest' : 54;
  const window=resolveHealthWorkspaceWindow({metric,range,endDate:'2026-09-15'},'2026-09-15');
  const records:HealthSourceRecord[]=accounts.map(accountKey=>({schemaVersion:1,id:accountKey,userID:'owner',kind:'daily_summary',calendarDate:'2026-09-14',startTimeMs:Date.parse('2026-09-14'),endTimeMs:Date.parse('2026-09-15')-1,
    source:{provider:'GarminAPI',accountKey,sourceRecordType:'daily',sourceRecordKey:accountKey,revision:{order:1,token:'1',digest:'1'},receivedAtMs:Date.parse('2026-09-15')},
    metricIds:[metric],metrics:[{kind:'value',metricId:metric,valueType:definition.valueType,aggregation:'average',semanticVariant:'recorded',origin:'provider_summary',recordingMethod:'provider_calculated',quality:{status:'valid'},normalizationStatus:'canonical',native:{metric,value,unit:definition.canonicalUnit},canonical:{value,unit:definition.canonicalUnit}}],
    coverage:{status:'complete'},sampleChunkIds:[],createdAtMs:0,updatedAtMs:0}));
  const result=projectLoadedHealthRange(records,[],{startDate:window.startDate,endDate:window.endDate,metricIds:[metric],includeSamples:window.includeSamples},{sourceRecordsComplete:true,samplesComplete:true,maximumSampleRangeDays:90});
  return {window,health:{result,limitReached:null,sourceRecordCount:records.length,sampleChunkCount:0,samplePointCount:0,serializedBytes:0,hasMatchingSourceRecords:!!records.length,hasSampleBackedMetric:false,providers:['GarminAPI'],sampleBackedProviders:[]},history:null,activities:null,sessions:[],errors:[]};
}
describe('dashboard Health semantics',()=>{
  it('restores an opaque Sleep preference and retains it as unavailable instead of switching accounts', () => {
    const data = evidence('sleep_duration', []);
    const base = { userID: 'owner', sleepDate: '2026-09-14', startTimeMs: Date.parse('2026-09-13T23:00:00Z'),
      endTimeMs: Date.parse('2026-09-14T07:00:00Z'), durationSeconds: 28800, isNap: false, stages: [],
      stageDurationsSeconds: {}, vitals: {}, createdAtMs: 0, updatedAtMs: 0 };
    data.sessions = ['first', 'second'].map(account => ({ ...base, id: account,
      source: { provider: 'SuuntoApp', providerUserId: account, sourceSessionKey: account } }));
    const all = buildDashboardHealthContext(data, { metric: 'sleep', range: '30d' });
    const rawKey = all.sources[1].key;
    const sourceKey = opaqueHealthSeriesId(rawKey);
    const settings = { metric: 'sleep' as const, range: '30d' as const, sourceKey };
    const pinned = buildDashboardHealthContext(data, settings);
    expect(pinned.selectedKey).toBe(rawKey);
    expect(pinned.hasData).toBe(true);
    expect(pinned.missingSource).toBe(false);
    expect(buildDashboardHealthContext(data, { ...settings, sourceKey: rawKey }).selectedKey).toBe(rawKey);
    data.sessions = data.sessions.slice(0, 1);
    const missing = buildDashboardHealthContext(data, settings);
    expect(missing.selectedKey).toBe(sourceKey);
    expect(missing.missingSource).toBe(true);
    expect(missing.hasData).toBe(false);
    expect(missing.sleep.hasRealPoints).toBe(false);
    expect(missing.sources).toHaveLength(1);
  });
  it.each(['visible', 'history'])('shares typed Sleep account evidence from %s across HRV card and baseline', location => {
    const data = evidence('heart_rate_variability');
    const sessions: SleepSession[] = Array.from({ length: 90 }, (_, index) => {
      const endTimeMs = Date.parse('2026-09-15T08:00:00Z') - index * 86_400_000;
      return { id: `night-${index}`, userID: 'owner', source: { provider: 'GarminAPI', providerUserId: 'provider-account',
        sourceSessionKey: `night-${index}` }, sleepDate: new Date(endTimeMs).toISOString().slice(0, 10),
        startTimeMs: endTimeMs - 8 * 3_600_000, endTimeMs, durationSeconds: 28_800,
        isNap: false, stages: [], stageDurationsSeconds: {}, vitals: { averageHrvMs: 50 + index % 3 },
        createdAtMs: endTimeMs, updatedAtMs: endTimeMs };
    });
    const session = sessions[location === 'visible' ? 0 : 30];
    const reference = { ...data.health!.result.observations[0], calendarDate: session.sleepDate,
      startTimeMs: session.startTimeMs, endTimeMs: session.endTimeMs, entry: {
        kind: 'sleep_reference' as const, metricId: 'heart_rate_variability' as const, valueType: 'number' as const,
        aggregation: 'average', semanticVariant: 'sleep_session_average_hrv', origin: 'provider_summary' as const,
        recordingMethod: 'provider_calculated' as const, quality: { status: 'valid' as const },
        reference: { domain: 'sleep' as const, documentId: session.id!, field: 'vitals.averageHrvMs' as const },
      } };
    const historyWindow = { startDate: new Date(Date.parse(data.window.startDate) - 60 * 86_400_000).toISOString().slice(0, 10),
      endDate: new Date(Date.parse(data.window.startDate) - 86_400_000).toISOString().slice(0, 10) };
    data.history = { ...data.health!, result: projectLoadedHealthRange([], [],
      { ...historyWindow, metricIds: ['heart_rate_variability'] }, { sourceRecordsComplete: true, samplesComplete: true }) };
    data.health!.result.observations = location === 'visible' ? [reference] : [];
    data.history.result.observations = location === 'history' ? [reference] : [];
    data.sessions = sessions;
    for (const units of [null, normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles })]) {
      const view = buildDashboardHealthContext(data, { metric: 'heart_rate_variability', range: '30d' }, units);
      expect(view.sources).toHaveLength(1);
      expect(view.selected?.status).toMatchObject({ observationDayCount: 60, normalRange: expect.any(Object) });
      expect(view.selected?.model.series.sourceLabel).toBe('Garmin');
      expect(view.selected?.latestValueText).toBe('50 ms');
    }
  });
  it('filters overview evidence before selecting a source and never broadens a missing pinned reading', () => {
    const data = evidence('body_weight');
    const first = buildDashboardHealthContext(data, { metric: 'body_weight', range: '30d' });
    expect(filterDashboardHealthEvidence(data, [])).toBe(data);
    const filtered = filterDashboardHealthEvidence(data, ['QuantifiedSelf']);
    const view = buildDashboardHealthContext(filtered, { metric: 'body_weight', range: '30d', sourceKey: first.selectedKey! });
    expect(view.hasData).toBe(false); expect(view.sources).toEqual([]); expect(view.selectedKey).toBe(first.selectedKey);
    expect(filtered.health?.hasMatchingSourceRecords).toBe(false);
    expect(data.health?.result.observations.length).toBeGreaterThan(0);
  });
  it.each(DASHBOARD_HEALTH_GROUPS.flatMap(group=>group.metrics.map(metric=>metric.id)))('projects the selectable %s metric using its real Health chart model',metric=>{
    const view=buildDashboardHealthContext(evidence(metric),{metric,range:'30d'});
    expect(view.hasData).toBe(true); expect(view.selected?.model.series.metricId).toBe(metric);
    expect(view.selected?.model.displayedPointCount).toBe(1); expect(view.availability.state).toBe('ready');
  });
  it('keeps provider accounts separate and preserves a missing selected reading',()=>{
    const data=evidence('resting_heart_rate',['first','second']);
    const first=buildDashboardHealthContext(data,{metric:'resting_heart_rate',range:'30d'});
    expect(new Set(first.sources.map(item=>item.key)).size).toBe(2);
    const settings={metric:'resting_heart_rate' as const,range:'30d' as const,sourceKey:first.sources[1].key};
    const selected=buildDashboardHealthContext(data,settings);
    expect(selected.selectedKey).toBe(settings.sourceKey);
    const missing=buildDashboardHealthContext(evidence('resting_heart_rate',['first']),settings);
    expect(missing.hasData).toBe(false);expect(missing.missingSource).toBe(true);expect(missing.selectedKey).toBe(settings.sourceKey);
  });
  it('offers only sources with drawable points, retaining a saved unavailable selection', () => {
    const data = evidence('resting_heart_rate', ['empty', 'outside', 'real']);
    const original = buildDashboardHealthContext(data, { metric: 'resting_heart_rate', range: '30d' });
    const emptyKey = original.sources[0].key;
    const observations = data.health!.result.observations;
    const empty = observations.find(item => item.accountKey === 'empty')!;
    if (empty.entry.kind === 'value') empty.entry.canonical!.value = Number.NaN;
    observations.find(item => item.accountKey === 'outside')!.endTimeMs = data.window.endTimeMs + 1;
    const view = buildDashboardHealthContext(data, { metric: 'resting_heart_rate', range: '30d' });
    expect(view.sources).toHaveLength(1);
    expect(view.selected?.model.displayedPointCount).toBe(1);
    expect(view.hasData).toBe(true);
    const saved = buildDashboardHealthContext(data, { metric: 'resting_heart_rate', range: '30d', sourceKey: emptyKey });
    expect(saved.selectedKey).toBe(emptyKey);
    expect(saved.missingSource).toBe(true);
    expect(saved.hasData).toBe(false);
    expect(saved.selected).toBeNull();
  });
  it('retains a drawable enriched Sleep reading when the originating Health point is outside the selected window', async () => {
    const accountKey = await nightlyHealthAccountKey('owner', 'GarminAPI', 'provider-account');
    const data = evidence('heart_rate_variability', [accountKey]);
    const observation = data.health!.result.observations[0];
    if (observation.entry.kind !== 'value') throw new Error('Expected a Health value fixture');
    observation.entry.semanticVariant = 'overnight_rmssd';
    observation.endTimeMs = data.window.endTimeMs + 1;
    const endTimeMs = observation.startTimeMs + 8 * 3_600_000;
    const sessions = await enrichSleepWithNightlyHrv('owner', [{ id: 'night', userID: 'owner',
      source: { provider: 'GarminAPI', providerUserId: 'provider-account', sourceSessionKey: 'night' },
      sleepDate: observation.calendarDate, startTimeMs: observation.startTimeMs, endTimeMs,
      durationSeconds: 28_800, isNap: false, stages: [], stageDurationsSeconds: {},
      createdAtMs: endTimeMs, updatedAtMs: endTimeMs,
    }], [{ userID: 'owner', schemaVersion: 1, kind: 'interval_summary',
      source: { provider: 'GarminAPI', accountKey }, calendarDate: observation.calendarDate,
      startTimeMs: observation.startTimeMs, endTimeMs: observation.endTimeMs, metrics: [observation.entry],
    }]);
    data.sessions = await withHealthSleepAccountKeys('owner', sessions);
    const view = buildDashboardHealthContext(data, { metric: 'heart_rate_variability', range: '30d' });
    expect(view.hasData).toBe(true);
    expect(view.sources).toHaveLength(1);
    expect(view.selected?.model.series.semanticVariant).toBe('sleep_overnight_hrv');
    expect(view.selected?.latestValueText).toBe('54 ms');
    expect(view.selected?.model.displayedPoints[0].timestampMs).toBe(endTimeMs);
  });
  it('keeps valid zero readings and categorical states selectable', () => {
    for (const metric of ['steps', 'stress_state'] as const) {
      const data = evidence(metric);
      const entry = data.health!.result.observations[0].entry;
      if (entry.kind === 'value') entry.canonical!.value = metric === 'steps' ? 0 : 'rest';
      const view = buildDashboardHealthContext(data, { metric, range: '30d' });
      expect(view.sources).toHaveLength(1);
      expect(view.hasData).toBe(true);
    }
  });
  it.each(['steps', 'resting_heart_rate', 'heart_rate_variability', 'body_weight', 'vo2_max', 'active_energy'] as const)(
    'defaults %s to useful readings while retaining explicit zero-source choices and filters', metric => {
      const data = evidence(metric, ['zero', 'real']);
      for (const observation of data.health!.result.observations) {
        observation.provider = observation.accountKey === 'real' ? 'SuuntoApp' : 'GarminAPI';
        if (observation.entry.kind === 'value') observation.entry.canonical!.value = observation.accountKey === 'real' ? 54 : 0;
      }
      const settings = { metric, range: '30d' as const };
      const automatic = buildDashboardHealthContext(data, settings);
      expect(automatic.selected?.model.series.provider).toBe('SuuntoApp');
      const zeroKey = automatic.sources.find(source => source.provider === 'GarminAPI')!.key;
      const explicit = buildDashboardHealthContext(data, { ...settings, sourceKey: zeroKey });
      expect(explicit.selectedKey).toBe(zeroKey);
      expect(explicit.selected?.model.series.points[0].value).toBe(0);
      expect(explicit.hasData).toBe(true);
      expect(buildDashboardHealthContext(data, settings, null, undefined, ['GarminAPI']).selectedKey).toBe(zeroKey);
      expect(buildDashboardHealthContext(data, settings, null, undefined, ['GarminAPI', 'SuuntoApp']).selected?.model.series.provider).toBe('SuuntoApp');
    });
  it('ranks freshness without provider preference for meaningful zero readings', () => {
    const data = evidence('skin_temperature_deviation', ['older', 'recent']);
    for (const observation of data.health!.result.observations) {
      observation.provider = observation.accountKey === 'recent' ? 'SuuntoApp' : 'GarminAPI';
      observation.endTimeMs = Date.parse(observation.accountKey === 'recent' ? '2026-09-15T12:00:00Z' : '2026-09-14T12:00:00Z');
      observation.calendarDate = observation.accountKey === 'recent' ? '2026-09-15' : '2026-09-14';
      if (observation.entry.kind === 'value') observation.entry.canonical!.value = observation.accountKey === 'recent' ? 0 : 2;
    }
    const view = buildDashboardHealthContext(data, { metric: 'skin_temperature_deviation', range: '30d' });
    expect(view.selected?.model.series.provider).toBe('SuuntoApp');
    expect(view.selected?.model.series.points[0].value).toBe(0);
  });
  it('honors an HRV account preference within the provider filter and an explicit source over that preference', () => {
    const data = evidence('heart_rate_variability', ['preferred', 'other']);
    data.health!.result.observations.find(item => item.accountKey === 'other')!.provider = 'SuuntoApp';
    const settings = { metric: 'heart_rate_variability' as const, range: '30d' as const };
    const view = buildDashboardHealthContext(data, settings);
    const garmin = view.sources.find(source => source.provider === 'GarminAPI')!;
    const suunto = view.sources.find(source => source.provider === 'SuuntoApp')!;
    const hint = buildDashboardHealthContext(data, { ...settings, sourceKey: suunto.key }).selected!.model.series.sourceSelectionKey;
    expect(buildDashboardHealthContext(data, settings, null, hint).selectedKey).toBe(suunto.key);
    expect(buildDashboardHealthContext(data, settings, null, hint, ['GarminAPI']).selectedKey).toBe(garmin.key);
    expect(buildDashboardHealthContext(data, { ...settings, sourceKey: garmin.key }, null, hint).selectedKey).toBe(garmin.key);
  });
  it('defaults Sleep to the source with the newest rendered night', () => {
    const data = evidence('sleep_duration', []);
    const base = { userID: 'owner', startTimeMs: Date.parse('2026-09-13T22:00:00Z'),
      endTimeMs: Date.parse('2026-09-14T06:00:00Z'), durationSeconds: 28800,
      stages: [], isNap: false, createdAtMs: 0, updatedAtMs: 0 };
    data.sessions = [
      { ...base, id: 'older', sleepDate: '2026-09-14', source: { provider: 'GarminAPI', providerUserId: 'garmin', sourceSessionKey: 'older' } },
      { ...base, id: 'recent', sleepDate: '2026-09-15', startTimeMs: base.startTimeMs + 86400000,
        endTimeMs: base.endTimeMs + 86400000, source: { provider: 'SuuntoApp', providerUserId: 'suunto', sourceSessionKey: 'recent' } },
    ];
    expect(buildDashboardHealthContext(data, { metric: 'sleep', range: '30d' }).sleep.latestPoint?.provider).toBe('SuuntoApp');
  });
  it('does not offer a Sleep source whose sessions cannot be rendered', () => {
    const data = evidence('sleep_duration', []);
    const session = { id: 'night', userID: 'owner', sleepDate: '2026-09-14',
      source: { provider: 'SuuntoApp' as const, accountKey: 'valid', providerUserId: 'provider', sourceSessionKey: 'night' },
      startTimeMs: Date.parse('2026-09-13T22:00:00Z'), endTimeMs: Date.parse('2026-09-14T06:00:00Z'),
      durationSeconds: 28800, stages: [], isNap: false, createdAtMs: 0, updatedAtMs: 0 };
    data.sessions = [session, { ...session, id: 'invalid', source: { ...session.source, accountKey: 'empty' }, endTimeMs: session.startTimeMs }];
    const view = buildDashboardHealthContext(data, { metric: 'sleep', range: '30d' });
    expect(view.sources).toHaveLength(1);
    expect(view.hasData).toBe(true);
    expect(view.sleep.latestPoint?.endTimeMs).toBe(session.endTimeMs);
  });
  it('numbers dashboard Sleep accounts within each provider', () => {
    const data = evidence('sleep_duration', []);
    const base = { userID: 'owner', sleepDate: '2026-09-14',
      startTimeMs: Date.parse('2026-09-13T22:00:00Z'), endTimeMs: Date.parse('2026-09-14T06:00:00Z'),
      durationSeconds: 28800, stages: [], stageDurationsSeconds: {}, isNap: false, createdAtMs: 0, updatedAtMs: 0 };
    data.sessions = [
      { ...base, id: 'garmin', source: { provider: 'GarminAPI', providerUserId: 'garmin', sourceSessionKey: 'garmin' } },
      { ...base, id: 'suunto-one', source: { provider: 'SuuntoApp', providerUserId: 'suunto-one', sourceSessionKey: 'suunto-one' } },
      { ...base, id: 'suunto-two', source: { provider: 'SuuntoApp', providerUserId: 'suunto-two', sourceSessionKey: 'suunto-two' } },
    ];

    const view = buildDashboardHealthContext(data, { metric: 'sleep', range: '30d' });

    expect(view.sources.find(source => source.provider === 'GarminAPI')?.label).toBe('Garmin');
    expect(view.sources.filter(source => source.provider === 'SuuntoApp').map(source => source.label))
      .toEqual(['Suunto · Account 1', 'Suunto · Account 2']);
  });
  it.each(['sleep_duration', 'sleep_score'] as const)('uses real Suunto Sleep sessions for %s previews and availability', metric => {
    const data = evidence(metric, []);
    data.sessions = [{ id: 'night', userID: 'owner', sleepDate: '2026-09-14',
      source: { provider: 'SuuntoApp', providerUserId: 'account', sourceSessionKey: 'night' },
      startTimeMs: Date.parse('2026-09-13T22:00:00Z'), endTimeMs: Date.parse('2026-09-14T06:00:00Z'),
      durationSeconds: 27000, score: { value: 82 }, stages: [], stageDurationsSeconds: {}, isNap: false, createdAtMs: 0, updatedAtMs: 0 }];
    const view = buildDashboardHealthContext(data, { metric, range: '30d' });
    expect(view.availability.state).toBe('ready');
    expect(view.sources).toHaveLength(1);
    expect(view.selected?.model.series.provider).toBe('SuuntoApp');
    expect(view.selected?.model.series.points[0].value).toBe(metric === 'sleep_duration' ? 27000 : 82);
    data.sessions.push({ ...data.sessions[0], id: 'nap', isNap: true, durationSeconds: 1800, score: { value: 70 } });
    const withNap = buildDashboardHealthContext(data, { metric, range: '30d' });
    expect(withNap.sources).toHaveLength(2);
    expect(withNap.selected?.model.series.semanticVariant).toBe(metric === 'sleep_duration' ? 'session_duration' : 'session_score');
    const nap = buildDashboardHealthContext(data, { metric, range: '30d', sourceKey: withNap.sources[1].key });
    expect(nap.selected?.model.series.semanticVariant).toBe(metric === 'sleep_duration' ? 'nap_duration' : 'nap_score');
    const noScore = evidence('sleep_score', []);
    noScore.sessions = data.sessions.map(session => ({ ...session, score: null }));
    const missing = buildDashboardHealthContext(noScore, { metric: 'sleep_score', range: '30d' });
    expect(missing.hasData).toBe(false);
    expect(missing.sources).toHaveLength(0);
  });
  it.each(['heart_rate', 'resting_heart_rate', 'blood_oxygen_saturation', 'respiration_rate'] as const)(
    'uses real Sleep readings for the %s tile, source choices and preview eligibility even if Health fails', metric => {
      const data = evidence(metric, []);
      data.health = null; data.errors = ['Health readings'];
      data.sessions = [{ id: 'night', userID: 'owner', sleepDate: '2026-09-14',
        source: { provider: 'SuuntoApp', providerUserId: 'account', sourceSessionKey: 'night' },
        startTimeMs: Date.parse('2026-09-13T22:00:00Z'), endTimeMs: Date.parse('2026-09-14T06:00:00Z'),
        durationSeconds: 27000, stages: [], isNap: false, createdAtMs: 0, updatedAtMs: 0,
        vitals: { averageHeartRateBpm: 57, restingHeartRateBpm: 50, maxSpo2Percent: 98, averageRespirationBrpm: 14 } }];
      const view = buildDashboardHealthContext(data, { metric, range: '30d' });
      expect(view.hasData).toBe(true); expect(view.availability.state).toBe('ready');
      expect(view.sources).toHaveLength(1);
      const expectedReading = {
        heart_rate: 'Average sleep HR',
        resting_heart_rate: 'Sleep resting HR',
        blood_oxygen_saturation: 'Maximum sleep SpO₂',
        respiration_rate: 'Average sleep breathing rate',
      }[metric];
      expect(view.sources[0].shortLabel).toBe(`Suunto · ${expectedReading}`);
      expect(view.selected?.model.series.provider).toBe('SuuntoApp');
      expect(view.notices).toContain('Health readings could not be loaded. Try again.');
    });
  it('distinguishes long-range sample-only, empty, limited, failed, and partial results',()=>{
    const data=evidence('heart_rate',[],'1y'); const settings={metric:'heart_rate' as const,range:'1y' as const};
    expect(buildDashboardHealthContext(data,settings).availability.state).toBe('no-data');
    data.health!.hasSampleBackedMetric=true;
    expect(buildDashboardHealthContext(data,settings)).toMatchObject({ sampleOnly: true, sampleRangeLimited: true });
    data.errors=['Health readings'];
    expect(buildDashboardHealthContext(data,settings).availability.state).toBe('error');
    const partial=evidence('heart_rate'); partial.errors=['Sleep readings'];
    const view=buildDashboardHealthContext(partial,settings); expect(view.hasData).toBe(true);expect(view.notices).toHaveLength(1);
  });
  it('does not silently replace a Health provider filter with another source', () => {
    const view = buildDashboardHealthContext(evidence('resting_heart_rate'), { metric: 'resting_heart_rate', range: '30d' }, null, undefined, ['SuuntoApp']);
    expect(view.selectedKey).toBeNull(); expect(view.hasData).toBe(false);
    expect(view.availability.reason).toContain('Health source filter');
    expect(view.sources).toHaveLength(1);
  });
  it('uses canonical Health display conversion for default and alternate units', () => {
    for (const units of [normalizeUserUnitSettings(), normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles })]) {
      const view = buildDashboardHealthContext(evidence('wheelchair_push_distance'), { metric: 'wheelchair_push_distance', range: '30d' }, units);
      const display = formatCanonicalHealthMetricSportsLibValue('wheelchair_push_distance', 54, units)!;
      expect(view.selected?.latestValueText).toBe(`${display.value} ${display.unit}`);
    }
  });
  it('allows standalone HRV before its personal range exists',()=>{
    const view=buildDashboardHealthContext(evidence('heart_rate_variability'),{metric:'heart_rate_variability',range:'30d'});
    expect(view.availability.state).toBe('ready');expect(view.selected?.status).toBeNull();
  });
  it('labels retained readings as stale after a source refresh fails', () => {
    const data = evidence('resting_heart_rate');
    data.errors = ['Health readings']; data.staleSources = ['Health readings'];
    const view = buildDashboardHealthContext(data, { metric: 'resting_heart_rate', range: '30d' });
    expect(view.hasData).toBe(true);
    expect(view.notices).toEqual(['Health readings could not be refreshed. Previous readings are shown. Try again.']);
    expect(view.failedSources).toBe(1);
  });

});
