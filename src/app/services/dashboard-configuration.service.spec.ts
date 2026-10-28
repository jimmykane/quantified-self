import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Firestore, runTransaction, doc } from '../firebase/firestore';
import { assertDashboardConfigurationCurrent, DashboardConfigurationConflict, DashboardConfigurationService } from './dashboard-configuration.service';
import { mergeUserProfileDocuments } from './user-profile-verification.service';
import { AppUserUtilities } from '../utils/app.user.utilities';
import { mergeWith } from 'lodash-es';
import type { AppDashboardSettingsInterface } from '../models/app-user.interface';
import { markDashboardAutoTileAdded } from '../helpers/dashboard-auto-tile.helper';
vi.mock('../firebase/firestore', () => ({ Firestore: 'Firestore', doc: vi.fn(), runTransaction: vi.fn() }));

describe('dashboard configuration writes', () => {
  beforeEach(() => { TestBed.configureTestingModule({ providers: [{ provide: Firestore, useValue: {} }] }); });
  it('treats missing defaults consistently but detects reordered tiles and changed preferences', () => {
    expect(() => assertDashboardConfigurationCurrent({ tiles: [] }, { tiles: [], showTodaySummary: true }, ['tiles', 'showTodaySummary'])).not.toThrow();
    expect(() => assertDashboardConfigurationCurrent({ tiles: [] }, { tiles: [{ order: 1 }] } as never, ['tiles'])).toThrow(DashboardConfigurationConflict);
  });
  it('merges only the dashboard patch and leaves private settings untouched', async () => {
    const set = vi.fn();
    vi.mocked(runTransaction).mockImplementation(async (_db, callback) => callback({ get: async () => ({ exists: () => true, data: () => ({ trainingSettings: { private: true }, dashboardSettings: { tiles: [] } }) }), set } as never));
    await TestBed.inject(DashboardConfigurationService).save('owner', { tiles: [] }, { tiles: [], showTodaySummary: false });
    expect(doc).toHaveBeenCalledWith({}, 'users', 'owner', 'config', 'settings');
    expect(set).toHaveBeenCalledWith(undefined, { dashboardSettings: { tiles: [], showTodaySummary: false } }, {
      mergeFields: ['dashboardSettings.tiles', 'dashboardSettings.showTodaySummary'],
    });
  });
  it('does not write when an editor or Undo baseline is stale', async () => {
    const set = vi.fn();
    vi.mocked(runTransaction).mockImplementation(async (_db, callback) => callback({ get: async () => ({ exists: () => true, data: () => ({ dashboardSettings: { showTodaySummary: false } }) }), set } as never));
    await expect(TestBed.inject(DashboardConfigurationService).save('owner', { showTodaySummary: true }, { showTodaySummary: false })).rejects.toThrow(DashboardConfigurationConflict);
    expect(set).not.toHaveBeenCalled();
  });
  it('accepts a legacy stored layout after profile hydration adds tile defaults', async () => {
    const tile = AppUserUtilities.getDefaultUserDashboardChartTile();
    delete tile['eventFilters'];
    const stored = { tiles: [tile] };
    const baseline = (await mergeUserProfileDocuments('owner', { settings: { dashboardSettings: structuredClone(stored) } }))!.settings.dashboardSettings;
    expect(baseline.tiles).not.toEqual(stored.tiles);
    const set = vi.fn();
    vi.mocked(runTransaction).mockImplementation(async (_db, callback) => callback({ get: async () => ({ exists: () => true, data: () => ({ dashboardSettings: stored }) }), set } as never));
    await TestBed.inject(DashboardConfigurationService).save('owner', baseline, { tiles: [] });
    expect(set).toHaveBeenCalledOnce();
    expect(stored.tiles[0]['eventFilters']).toBeUndefined();
    await expect(TestBed.inject(DashboardConfigurationService).save('owner', { ...baseline, tiles: [] }, { tiles: [] })).rejects.toThrow(DashboardConfigurationConflict);
  });
  it('allows saving a chart immediately after adding it over a dismissed suggestion', async () => {
    const suggestion = 'preset:custom-distance-columns';
    const stored: Partial<AppDashboardSettingsInterface> = {
      tiles: [], autoTiles: { [suggestion]: { state: 'dismissed', dismissedAt: 100, source: 'chart-library' } },
    };
    const baseline = structuredClone(stored);
    const added = structuredClone(baseline);
    added.tiles = [AppUserUtilities.getDefaultUserDashboardChartTile()];
    markDashboardAutoTileAdded(added as AppDashboardSettingsInterface, suggestion, 'chart-library', 200);
    const set = vi.fn((_reference, data: { dashboardSettings: Partial<AppDashboardSettingsInterface> }, options: { merge?: boolean; mergeFields?: string[] }) => {
      // Firestore's merge:true retains omitted nested map fields. Explicit masks
      // replace the named fields, including an auto-tile state's old timestamps.
      for (const [key, value] of Object.entries(data.dashboardSettings)) {
        stored[key] = options.mergeFields?.includes(`dashboardSettings.${key}`)
          ? structuredClone(value)
          : mergeWith({ value: stored[key] }, { value }, (_previous, next) => Array.isArray(next) ? next : undefined).value;
      }
    });
    vi.mocked(runTransaction).mockImplementation(async (_db, callback) => callback({
      get: async () => ({ exists: () => true, data: () => ({ dashboardSettings: structuredClone(stored) }) }), set,
    } as never));
    const service = TestBed.inject(DashboardConfigurationService);
    await service.save('owner', baseline, added);
    const edited = structuredClone(added);
    edited.tiles[0].name = 'My distance';
    await expect(service.save('owner', added, edited)).resolves.toBeUndefined();
    expect(stored).toEqual(edited);
    expect(stored.autoTiles[suggestion]).not.toHaveProperty('dismissedAt');
    // A real concurrent resize must still reject the editor's earlier baseline.
    stored.tiles[0].size.columns = 2;
    await expect(service.save('owner', edited, edited)).rejects.toThrow(DashboardConfigurationConflict);
    expect(set).toHaveBeenCalledTimes(2);
  });
});
