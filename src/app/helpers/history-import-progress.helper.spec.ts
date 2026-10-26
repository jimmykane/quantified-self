import { describe, expect, it } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { HISTORY_IMPORT_RECENT_MS, buildHistoryImportProgress } from './history-import-progress.helper';
const now = Date.UTC(2026, 9, 26);
function projection(status = 'requesting', active = true) {
  return {runId: 'run', rangePreset: '30_days', active, updatedAtMs: now,
    steps: [{id: 'activities', resources: ['activities'], status, count: 128}]};
}
function view(value: unknown, serviceName = ServiceNames.SuuntoApp, at = now) {
  return buildHistoryImportProgress([{serviceName, projection: value}], at);
}
describe('history import progress presentation', () => {
  it('keeps provider counts separate and active work ahead of completed results', () => {
    const result = buildHistoryImportProgress([
      {serviceName: ServiceNames.GarminAPI, projection: projection('processed', false)},
      {serviceName: ServiceNames.SuuntoApp, projection: projection()},
      {serviceName: ServiceNames.COROSAPI, projection: projection('retrying')},
      {serviceName: ServiceNames.WahooAPI, projection: projection('failed', false)},
    ], now);
    expect(result.items.map(item => item.name)).toEqual(['Suunto', 'COROS', 'Wahoo', 'Garmin']);
    expect(result.label).toBe('Importing history');
    expect(result.items[0].steps[0].count).toBe(128);
    expect(JSON.stringify(result)).not.toMatch(/percent|eta/i);
  });
  it('never treats a submitted Garmin request as active processing or proven delivery', () => {
    const result = view(projection('requested', false), ServiceNames.GarminAPI);
    expect(result.active).toBe(false);
    expect(result.label).toBe('History requested');
    expect(result.items[0].steps[0].description).toContain('delivery may take hours or days');
    expect(result.items[0].kind).toBe('requested');
  });
  it('shows an automatic retry without requiring another user action', () => {
    const result = view(projection('retrying'));
    expect(result.active).toBe(true);
    expect(result.items[0].label).toBe('Waiting to retry');
  });
  it.each(['failed', 'skipped'])('keeps %s outcomes visible until superseded', status => {
    const result = view(projection(status, false), ServiceNames.SuuntoApp, now + 10 * HISTORY_IMPORT_RECENT_MS);
    expect(result.label).toBe('History finished with issues');
    expect(result.active).toBe(false);
    expect(result.items[0].label).toBe('Finished with issues');
    expect(result.items[0].canDismiss).toBe(true);
    expect(result.items[0].kind).toBe('attention');
    expect(result.nextExpiryAtMs).toBeNull();
  });
  it('dismisses only the exact finished result and keeps other providers and resumed work visible', () => {
    const dismissed = [{serviceName: ServiceNames.SuuntoApp, runId: 'run', updatedAtMs: now}];
    const result = buildHistoryImportProgress([
      {serviceName: ServiceNames.SuuntoApp, projection: projection('failed', false)},
      {serviceName: ServiceNames.COROSAPI, projection: projection('failed', false)},
    ], now, dismissed);
    expect(result.items.map(item => item.serviceName)).toEqual([ServiceNames.COROSAPI]);
    for (const next of [projection(), {...projection('failed', false), updatedAtMs: now + 1},
      {...projection('failed', false), runId: 'new-run'}]) {
      expect(buildHistoryImportProgress([{serviceName: ServiceNames.SuuntoApp, projection: next}], now, dismissed).items).toHaveLength(1);
    }
  });
  it.each(['processed', 'requested'])('expires recent %s context at exactly 24 hours', status => {
    const value = projection(status, false);
    expect(view(value, ServiceNames.SuuntoApp, now + HISTORY_IMPORT_RECENT_MS - 1).items).toHaveLength(1);
    expect(view(value, ServiceNames.SuuntoApp, now + HISTORY_IMPORT_RECENT_MS).items).toEqual([]);
  });
  it('does not expire active work or invent a progress denominator', () => {
    expect(view(projection(), ServiceNames.SuuntoApp, now + 10 * HISTORY_IMPORT_RECENT_MS).items).toHaveLength(1);
    expect(view(projection()).nextExpiryAtMs).toBeNull();
  });
  it('represents read errors as unavailable rather than zero imports', () => {
    const result = buildHistoryImportProgress([{serviceName: ServiceNames.WahooAPI, unavailable: true}], now);
    expect(result.label).toBe('Import status unavailable');
    expect(result.active).toBe(false);
    expect(result.items[0].kind).toBe('unavailable');
  });
  it('does not claim history finished while another provider status is unavailable', () => {
    const result = buildHistoryImportProgress([
      {serviceName: ServiceNames.SuuntoApp, projection: projection('failed', false)},
      {serviceName: ServiceNames.WahooAPI, unavailable: true},
    ], now);
    expect(result.label).toBe('Import status unavailable');
    expect(result.items[0].label).toBe('Finished with issues');
    expect(result.items[0].canDismiss).toBe(true);
  });
  it.each([{}, {...projection(), active: 'yes'}, {...projection(), updatedAtMs: NaN},
    {...projection(), steps: [{id: 'a', status: 'unknown', resources: ['activities']}]},
    {...projection(), steps: [{id: 'a', status: 'queued', resources: ['unknown']}]},
  ])('handles malformed projections as unavailable', value => {
    expect(view(value).items[0].kind).toBe('unavailable');
  });
  it('does not invent zero for a malformed counter or double-count a combined resource', () => {
    const value = {...projection(), steps: [{id: 'daily', resources: ['sleep', 'health'], status: 'queued', count: NaN}]};
    expect(view(value).items[0].steps).toMatchObject([{label: 'Sleep & Health', count: null}]);
  });
  it('does not mutate metadata or copy extra operational fields into the presentation', () => {
    const value = {...projection(), privateField: 'not-for-ui'};
    const before = JSON.stringify(value);
    expect(JSON.stringify(view(value))).not.toContain('not-for-ui');
    expect(JSON.stringify(value)).toBe(before);
  });
  it('treats confirmed missing metadata as no import', () => {
    expect(view(undefined).items).toEqual([]);
    expect(view(null).items).toEqual([]);
  });
  it('never labels an inconsistent inactive queued projection as processed', () => {
    expect(view(projection('queued', false)).items[0].kind).toBe('unavailable');
  });
  it.each(['disconnect_pending', null] as const)('hides retained progress after the connection becomes %s', connectionState => {
    const result = buildHistoryImportProgress([
      {serviceName: ServiceNames.SuuntoApp, projection: projection(), connectionState},
    ], now);
    expect(result.items).toEqual([]);
    expect(result.active).toBe(false);
  });
  it('shows reconnect guidance instead of stale in-progress stages after authorization is lost', () => {
    const result = buildHistoryImportProgress([
      {serviceName: ServiceNames.COROSAPI, projection: projection('retrying'), connectionState: 'reconnect_required'},
    ], now);
    expect(result.active).toBe(false);
    expect(result.label).toBe('History needs attention');
    expect(result.items[0]).toMatchObject({kind: 'attention', label: 'Reconnect required', steps: []});
    expect(result.items[0].canDismiss).not.toBe(true);
    expect(result.items[0].explanation).toContain('Open Connections');
  });
});
