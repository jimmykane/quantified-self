import { DistanceUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { formatCanonicalHealthMetricSportsLibValue } from '@shared/sports-lib-health-data';
import { describe, expect, it } from 'vitest';
import { HEALTH_METRIC_CATALOG, HealthMetricId, HealthSourceRecord } from '@shared/health';
import { projectLoadedHealthRange } from '@shared/health-query';
import { AppDashboardHealthMetricSettings } from '../models/app-user.interface';
import { buildDashboardHealthContext, DashboardHealthEvidence } from './dashboard-health-context.helper';
import { DASHBOARD_HEALTH_GROUPS } from './dashboard-health-tile.helper';
import { resolveHealthWorkspaceWindow } from './health-workspace.helper';

function evidence(metric:HealthMetricId, accounts=['first'], range:AppDashboardHealthMetricSettings['range']='30d'):DashboardHealthEvidence {
  const definition=HEALTH_METRIC_CATALOG[metric]; const value=definition.valueType==='category' ? 'rest' : 54;
  const window=resolveHealthWorkspaceWindow({metric,range,endDate:'2026-09-15'},'2026-09-15');
  const records:HealthSourceRecord[]=accounts.map(accountKey=>({schemaVersion:1,id:accountKey,userID:'owner',kind:'daily_summary',calendarDate:'2026-09-14',startTimeMs:Date.parse('2026-09-14'),endTimeMs:Date.parse('2026-09-15')-1,
    source:{provider:'GarminAPI',accountKey,sourceRecordType:'daily',sourceRecordKey:accountKey,revision:{order:1,token:'1',digest:'1'},receivedAtMs:Date.parse('2026-09-15')},
    metricIds:[metric],metrics:[{kind:'value',metricId:metric,valueType:definition.valueType,aggregation:'average',semanticVariant:'recorded',origin:'provider_summary',recordingMethod:'provider_calculated',quality:{status:'valid'},normalizationStatus:'canonical',native:{metric,value,unit:definition.canonicalUnit},canonical:{value,unit:definition.canonicalUnit}}],
    coverage:{status:'complete'},sampleChunkIds:[],createdAtMs:0,updatedAtMs:0}));
  const result=projectLoadedHealthRange(records,[],{startDate:window.startDate,endDate:window.endDate,metricIds:[metric],includeSamples:window.includeSamples},{sourceRecordsComplete:true,samplesComplete:true});
  return {window,health:{result,limitReached:null,sourceRecordCount:records.length,sampleChunkCount:0,samplePointCount:0,serializedBytes:0,hasMatchingSourceRecords:!!records.length,hasSampleBackedMetric:false,providers:['GarminAPI'],sampleBackedProviders:[]},history:null,activities:null,sessions:[],errors:[]};
}
describe('dashboard Health semantics',()=>{
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
  it('distinguishes long-range sample-only, empty, limited, failed, and partial results',()=>{
    const data=evidence('heart_rate',[],'1y'); const settings={metric:'heart_rate' as const,range:'1y' as const};
    expect(buildDashboardHealthContext(data,settings).availability.state).toBe('no-data');
    data.health!.hasSampleBackedMetric=true;
    expect(buildDashboardHealthContext(data,settings).sampleOnly).toBe(true);
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
