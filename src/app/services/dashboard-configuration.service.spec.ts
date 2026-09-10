import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Firestore, runTransaction, doc } from '../firebase/firestore';
import { assertDashboardConfigurationCurrent, DashboardConfigurationConflict, DashboardConfigurationService } from './dashboard-configuration.service';
import { mergeUserProfileDocuments } from './user-profile-verification.service';
import { AppUserUtilities } from '../utils/app.user.utilities';
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
    expect(set).toHaveBeenCalledWith(undefined, { dashboardSettings: { tiles: [], showTodaySummary: false } }, { merge: true });
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
    const baseline = mergeUserProfileDocuments('owner', { settings: { dashboardSettings: structuredClone(stored) } })!.settings.dashboardSettings;
    expect(baseline.tiles).not.toEqual(stored.tiles);
    const set = vi.fn();
    vi.mocked(runTransaction).mockImplementation(async (_db, callback) => callback({ get: async () => ({ exists: () => true, data: () => ({ dashboardSettings: stored }) }), set } as never));
    await TestBed.inject(DashboardConfigurationService).save('owner', baseline, { tiles: [] });
    expect(set).toHaveBeenCalledOnce();
    expect(stored.tiles[0]['eventFilters']).toBeUndefined();
    await expect(TestBed.inject(DashboardConfigurationService).save('owner', { ...baseline, tiles: [] }, { tiles: [] })).rejects.toThrow(DashboardConfigurationConflict);
  });
});
