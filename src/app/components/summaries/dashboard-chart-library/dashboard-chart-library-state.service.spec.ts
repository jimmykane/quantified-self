import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { DashboardChartLibraryState } from './dashboard-chart-library-state.service';
import { DashboardConfigurationService, DashboardConfigurationConflict, assertDashboardConfigurationCurrent } from '../../../services/dashboard-configuration.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppSleepService } from '../../../services/app.sleep.service';
import { AppRouteService } from '../../../services/app.route.service';
import { DashboardDerivedMetricsService, createDashboardDerivedMetricsMissingState } from '../../../services/dashboard-derived-metrics.service';
import { getDashboardChartCatalog, getAvailableDashboardCharts } from '../../../helpers/dashboard-chart-catalog.helper';
import { AppUserInterface } from '../../../models/app-user.interface';

describe('inline chart library state', () => {
  let state: DashboardChartLibraryState;
  let user: AppUserInterface;
  const persistence = { save: vi.fn() };
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  const dialog = { open: vi.fn() };
  const watch = vi.fn();
  const calendar = getDashboardChartCatalog().find(entry => entry.definition.id === 'curated-activity-calendar')!;
  beforeEach(() => {
    vi.clearAllMocks(); persistence.save.mockResolvedValue(undefined); dialog.open.mockReturnValue({ afterClosed: () => of(false) });
    watch.mockReturnValue(of(createDashboardDerivedMetricsMissingState()));
    TestBed.configureTestingModule({ providers: [DashboardChartLibraryState,
      { provide: DashboardConfigurationService, useValue: persistence }, { provide: AppHapticsService, useValue: haptics }, { provide: MatDialog, useValue: dialog },
      { provide: AppEventService, useValue: { getEventsBy: vi.fn(() => of([])) } }, { provide: AppSleepService, useValue: { watchForDashboard: vi.fn(() => of([])) } },
      { provide: AppRouteService, useValue: { watchHasAnyRoutePreview: vi.fn(() => of(false)) } }, { provide: DashboardDerivedMetricsService, useValue: { watch } },
    ] });
    user = { uid: 'test-owner', settings: { unitSettings: { speedUnits: [], startOfTheWeek: 1 }, dashboardSettings: { tiles: [] } } } as unknown as AppUserInterface;
    state = TestBed.inject(DashboardChartLibraryState);
  });
  it('initializes silently and opens only one section without querying or saving', async () => {
    expect(haptics.selection).not.toHaveBeenCalled();
    await state.open('kpi'); await state.open('section:activityOverview');
    expect(state.activeLane()).toBe('section:activityOverview');
    expect(watch).not.toHaveBeenCalled(); expect(persistence.save).not.toHaveBeenCalled();
  });
  it('keeps selection and configuration local until Add, then supports guarded Undo', async () => {
    await state.open(calendar.lane); await state.select(user, calendar);
    expect(user.settings.dashboardSettings.tiles).toHaveLength(0);
    expect(persistence.save).not.toHaveBeenCalled();
    await state.save();
    expect(user.settings.dashboardSettings.tiles).toHaveLength(1);
    expect(state.activeLane()).toBeNull(); expect(state.undoAvailable()).toBe(true);
    expect(getAvailableDashboardCharts(calendar.lane, user.settings.dashboardSettings.tiles).some(entry => entry.definition.id === calendar.definition.id)).toBe(false);
    await state.undo(user);
    expect(user.settings.dashboardSettings.tiles).toHaveLength(0);
    expect(user.settings.dashboardSettings.autoTiles?.activityCalendar?.state).toBe('dismissed');
    expect(state.undoAvailable()).toBe(false);
    expect(haptics.success).toHaveBeenCalledTimes(2);
  });
  it('releases an unchanged preview silently without saving or closing the picker', async () => {
    await state.open(calendar.lane); await state.select(user, calendar);
    haptics.selection.mockClear();
    state.clearPreview();
    expect(state.draft()).toBeNull(); expect(state.selected()).toBeNull(); expect(state.editor()).toBeNull();
    expect(state.activeLane()).toBe(calendar.lane);
    expect(haptics.selection).not.toHaveBeenCalled(); expect(persistence.save).not.toHaveBeenCalled();
  });
  it('does not release a configured or changed draft when the chart list is filtered', async () => {
    await state.select(user, calendar); state.configure();
    const editor = state.editor();
    state.clearPreview(); expect(state.editor()).toBe(editor);
    state.configuring.set(false);
    editor!.category = 'custom'; state.refreshDraft();
    state.clearPreview(); expect(state.editor()).toBe(editor);
    expect(dialog.open).not.toHaveBeenCalled(); expect(persistence.save).not.toHaveBeenCalled();
  });
  it('does not release a preview while its save is pending', async () => {
    let resolve!: () => void; persistence.save.mockReturnValueOnce(new Promise<void>(done => resolve = done));
    await state.select(user, calendar);
    const draft = state.draft(); const saving = state.save();
    state.clearPreview(); expect(state.draft()).toBe(draft);
    resolve(); await saving;
    expect(persistence.save).toHaveBeenCalledOnce();
  });
  it('writes an explicit empty tile list when undoing the first addition on legacy settings', async () => {
    user.settings.dashboardSettings = {} as never;
    await state.select(user, calendar); await state.save(); await state.undo(user);
    expect(user.settings.dashboardSettings.tiles).toEqual([]);
    expect(persistence.save.mock.calls.at(-1)?.[2].tiles).toEqual([]);
  });
  it('preserves the draft and original layout when saving fails', async () => {
    await state.open(calendar.lane); await state.select(user, calendar);
    persistence.save.mockRejectedValueOnce(new DashboardConfigurationConflict());
    await state.save();
    expect(state.editor()).not.toBeNull(); expect(state.draft()).not.toBeNull();
    expect(state.error()).toContain('dashboard changed'); expect(user.settings.dashboardSettings.tiles).toHaveLength(0);
    expect(haptics.success).not.toHaveBeenCalled(); expect(haptics.error).toHaveBeenCalledTimes(1);
  });
  it('opens existing custom charts for editing in Activity Overview without changing their saved settings', async () => {
    const custom = structuredClone(getDashboardChartCatalog().find(entry => entry.definition.category === 'custom')!.tile);
    custom['dataType'] = 'DeviceName';
    user.settings.dashboardSettings.tiles = [custom];
    await state.edit(user, custom.order);
    expect(state.activeLane()).toBe('section:activityOverview');
    expect(state.editor()?.mode).toBe('edit');
    expect(state.draft()?.['dataType']).toBe('DeviceName');
    expect(user.settings.dashboardSettings.tiles).toEqual([custom]);
    expect(persistence.save).not.toHaveBeenCalled();
  });
  it('requires discarding a dirty draft before switching sections', async () => {
    await state.open('section:activityOverview'); await state.createCustom(user);
    state.editor()!.customEventRange = '30d'; state.refreshDraft();
    await state.open('kpi');
    expect(state.activeLane()).toBe('section:activityOverview'); expect(dialog.open).toHaveBeenCalledTimes(1);
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    await state.open('kpi'); expect(state.activeLane()).toBe('kpi'); expect(state.draft()).toBeNull();
  });
  it('previews an invalid duplicate choice and still guards unsaved changes', async () => {
    user.settings.dashboardSettings.tiles = [calendar.tile];
    await state.open('section:activityOverview'); await state.createCustom(user);
    state.editor()!.category = 'curated'; state.editor()!.curatedChartType = calendar.tile['chartType']; state.refreshDraft();
    expect(state.editor()!.isSaveDisabled).toBe(true);
    expect(state.draft()?.['chartType']).toBe(calendar.tile['chartType']);
    await state.close();
    expect(dialog.open).toHaveBeenCalledOnce(); expect(state.editor()).not.toBeNull();
    expect(persistence.save).not.toHaveBeenCalled();
  });
  it('previews retained chart display settings after changing away and back', async () => {
    const power = structuredClone(getDashboardChartCatalog().find(entry => entry.definition.id === 'curated-power-curve')!.tile);
    power['displaySettings'] = { powerCurveCompareMode: 'best30d' };
    user.settings.dashboardSettings.tiles = [power];
    await state.edit(user, power.order);
    state.editor()!.category = 'custom'; state.refreshDraft();
    state.editor()!.syncFormStateFromTile(power); state.refreshDraft();
    expect(state.draft()?.['eventFilters']).toEqual(power['eventFilters']);
    expect(state.draft()?.['displaySettings']).toEqual(power['displaySettings']);
    await state.save();
    expect(user.settings.dashboardSettings.tiles[0]['eventFilters']).toEqual(power['eventFilters']);
  });
  it('requires discarding an open draft before Undo and closes the stale editor after success', async () => {
    await state.select(user, calendar); await state.save();
    await state.open('section:activityOverview'); await state.createCustom(user);
    state.editor()!.customEventRange = '30d'; state.refreshDraft();
    await state.undo(user);
    expect(dialog.open).toHaveBeenCalledOnce(); expect(persistence.save).toHaveBeenCalledTimes(1);
    expect(state.editor()).not.toBeNull(); expect(state.undoAvailable()).toBe(true);
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    await state.undo(user);
    expect(user.settings.dashboardSettings.tiles).toEqual([]);
    expect(state.editor()).toBeNull(); expect(state.activeLane()).toBeNull();
  });
  it('disables Undo after another layout change and never removes a different tile', async () => {
    await state.select(user, calendar); await state.save();
    user.settings.dashboardSettings.tiles[0].size.columns = 4;
    state.invalidateUndo(user.settings.dashboardSettings); await state.undo(user);
    expect(state.undoAvailable()).toBe(false); expect(persistence.save).toHaveBeenCalledTimes(1);
    expect(user.settings.dashboardSettings.tiles).toHaveLength(1);
  });
  it('undoes only chart fields when local and persisted event-table filters differ', async () => {
    user.settings.dashboardSettings.eventTableFilters = { searchTerm: 'local search', startDate: 100, endDate: 200 } as never;
    let stored = { tiles: [], eventTableFilters: { searchTerm: 'stored search', startDate: 10, endDate: 20 } };
    persistence.save.mockImplementation(async (_uid, expected, patch) => {
      assertDashboardConfigurationCurrent(stored as never, expected, Object.keys(patch));
      stored = { ...stored, ...structuredClone(patch) };
    });
    await state.select(user, calendar); await state.save();
    user.settings.dashboardSettings.eventTableFilters.searchTerm = 'new local search';
    state.invalidateUndo(user.settings.dashboardSettings);
    expect(state.undoAvailable()).toBe(true);
    await state.undo(user);
    expect(state.error()).toBe('');
    expect(user.settings.dashboardSettings.tiles).toEqual([]);
    expect(user.settings.dashboardSettings.eventTableFilters.searchTerm).toBe('new local search');
    expect(stored.tiles).toEqual([]);
    expect(stored.eventTableFilters.searchTerm).toBe('stored search');
    expect(persistence.save.mock.calls.at(-1)?.[2]).not.toHaveProperty('eventTableFilters');
    expect(state.undoAvailable()).toBe(false);
  });
  it('keeps the open draft when a bulk confirmation is cancelled', async () => {
    await state.open(calendar.lane); await state.select(user, calendar);
    await state.bulk(user, 'clear');
    expect(state.draft()).not.toBeNull(); expect(state.activeLane()).toBe(calendar.lane);
    expect(persistence.save).not.toHaveBeenCalled();
  });
  it('clears account-specific drafts and ignores a save completing after the context changes', async () => {
    let resolve!: () => void; persistence.save.mockReturnValueOnce(new Promise<void>(done => resolve = done));
    await state.select(user, calendar); const saving = state.save();
    state.resetContext(); resolve(); await saving;
    expect(state.draft()).toBeNull(); expect(state.undoAvailable()).toBe(false); expect(state.error()).toBe('');
    expect(user.settings.dashboardSettings.tiles).toHaveLength(0);
  });
  it('persists the Today toggle without opening an editor or loading recommendations', async () => {
    await state.bulk(user, 'today');
    expect(user.settings.dashboardSettings.showTodaySummary).toBe(false);
    expect(persistence.save).toHaveBeenCalledTimes(1); expect(watch).not.toHaveBeenCalled();
  });
  it('ignores duplicate submissions while a save is pending', async () => {
    let resolve!: () => void; persistence.save.mockReturnValueOnce(new Promise<void>(done => resolve = done));
    await state.select(user, calendar); const saving = state.save(); await state.save();
    expect(state.busy()).toBe(true); expect(persistence.save).toHaveBeenCalledTimes(1);
    resolve(); await saving; expect(state.busy()).toBe(false);
  });
});
