import { DashboardHealthService } from '../../../services/dashboard-health.service';
import { DashboardChartDiscoveryService } from '../../../services/dashboard-chart-discovery.service';
import { CommonModule } from '@angular/common';
import { DashboardTileEditorComponent } from './dashboard-tile-editor.component';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { ConfirmationDialogComponent } from '../../confirmation-dialog/confirmation-dialog.component';
import { MatDialog } from '@angular/material/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY, of, Subject } from 'rxjs';
import { DashboardHrvService } from '../../../services/dashboard-hrv.service';
import { createDashboardDerivedMetricsMissingState } from '../../../services/dashboard-derived-metrics.service';
import { MaterialModule } from '../../../modules/material.module';
import { DashboardChartLibraryComponent } from './dashboard-chart-library.component';
import { DashboardChartLibraryState } from './dashboard-chart-library-state.service';
import { DashboardConfigurationService } from '../../../services/dashboard-configuration.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppSleepService } from '../../../services/app.sleep.service';
import { AppRouteService } from '../../../services/app.route.service';
import { DashboardDerivedMetricsService } from '../../../services/dashboard-derived-metrics.service';
import { AppUserInterface } from '../../../models/app-user.interface';
import { buildDashboardExampleEvents } from '../../../helpers/dashboard-chart-preview.helper';
import { getDashboardChartCatalog } from '../../../helpers/dashboard-chart-catalog.helper';

describe('responsive chart picker interactions', () => {
  let fixture: ComponentFixture<DashboardChartLibraryComponent>;
  let component: DashboardChartLibraryComponent;
  let user: AppUserInterface;
  let mobile = false;
  let discard = false;
  const save = vi.fn();
  const discovery = { seenRevision: vi.fn((_owner: AppUserInterface, _lane: string) => 1), acknowledge: vi.fn().mockResolvedValue(undefined) };
  const events = { getEventsBy: vi.fn() };
  const derived = { watch: vi.fn(), ensureForDashboard: vi.fn() };
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  const settle = async () => {
    // Material portals attach outside the fixture; flush their async click handlers before checking both views.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    fixture.detectChanges(); await fixture.whenStable();
  };
  const button = (label: string): HTMLButtonElement => Array.from(document.body.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(element => element.textContent?.includes(label))!;
  beforeEach(async () => {
    vi.restoreAllMocks(); vi.clearAllMocks(); mobile = false; discard = false; save.mockResolvedValue(undefined);
    discovery.seenRevision.mockImplementation((owner, lane) => owner.settings.appSettings?.dashboardChartLibrarySeen?.[lane] || 1);
    discovery.acknowledge.mockResolvedValue(undefined);
    derived.watch.mockReturnValue(of(createDashboardDerivedMetricsMissingState()));
    events.getEventsBy.mockReturnValue(of([]));
    await TestBed.configureTestingModule({ declarations: [DashboardChartLibraryComponent, DashboardTileEditorComponent], imports: [CommonModule, MaterialModule, NoopAnimationsModule], schemas: [NO_ERRORS_SCHEMA], providers: [
      {provide:DashboardHealthService,useValue:{watch:()=>EMPTY}}, DashboardChartLibraryState, { provide: DashboardChartDiscoveryService, useValue: discovery }, { provide: DashboardConfigurationService, useValue: { save } }, { provide: AppHapticsService, useValue: haptics },
      { provide: BreakpointObserver, useValue: { isMatched: () => mobile, observe: () => of({ matches: false, breakpoints: {} }) } },
      { provide: AppEventService, useValue: events }, { provide: AppSleepService, useValue: { watchForDashboard: () => of([]) } }, { provide: AppRouteService, useValue: { watchRecentRoutePreviews: () => of([]) } }, { provide: DashboardDerivedMetricsService, useValue: derived }, { provide: DashboardHrvService, useValue: { watch: () => of(null) } },
    ] }).compileComponents();
    const dialog = TestBed.inject(MatDialog);
    const realOpen = dialog.open.bind(dialog);
    vi.spyOn(dialog, 'open').mockImplementation((target, options) => target === ConfirmationDialogComponent
      ? { afterClosed: () => of(discard) } as never : realOpen(target, options));
    user = { uid: 'test-owner', settings: { unitSettings: { speedUnits: [] }, dashboardSettings: { tiles: [] } } } as unknown as AppUserInterface;
    fixture = TestBed.createComponent(DashboardChartLibraryComponent); component = fixture.componentInstance;
    fixture.componentRef.setInput('user', user); fixture.componentRef.setInput('lane', 'kpi'); fixture.componentRef.setInput('seed', { tiles: [] }); fixture.detectChanges();
  });
  it('aggregates new types without reads and switches sections inside one dashboard picker', async () => {
    fixture.componentRef.setInput('allSections', true);
    fixture.componentRef.setInput('lane', 'section:activityOverview'); await settle();
    expect(component.addActionLabel()).toContain('Add to dashboard');
    expect(component.unseen().length).toBeGreaterThan(0);
    expect(component.sections()).toHaveLength(7);
    expect(derived.watch).not.toHaveBeenCalled(); expect(events.getEventsBy).not.toHaveBeenCalled();
    expect(discovery.acknowledge).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
    await component.toggle(); await settle();
    expect(component.browseLane()).toBe('section:health');
    await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector('mat-select[aria-labelledby]')));
    const overlay = document.querySelector('[role="dialog"]');
    expect(discovery.acknowledge).toHaveBeenCalledWith(user, 'section:health', 2);
    await component.openSection('kpi', true); await settle();
    expect(component.browseLane()).toBe('kpi');
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')).toBe(overlay);
    const refreshed = { ...user, settings: { ...user.settings, appSettings: { dashboardChartLibrarySeen: { 'section:health': 2 } } } };
    fixture.componentRef.setInput('user', refreshed); await settle();
    await component.openSection('section:health', true); await settle();
    expect(component.unseen()).toHaveLength(0);
    expect(component.rowPreviews().some(entry => entry.isNew)).toBe(true);
    expect(discovery.acknowledge).toHaveBeenCalledTimes(1);
    expect(haptics.selection).toHaveBeenCalledTimes(3);
    expect(user.settings.dashboardSettings.tiles).toEqual([]);
    await component.openSection('section:health', true);
    expect(haptics.selection).toHaveBeenCalledTimes(3);
  });

  it('starts global browsing in an available section when the preferred section is complete', async () => {
    fixture.componentRef.setInput('allSections', true); fixture.componentRef.setInput('lane', 'section:activityOverview');
    const catalog = getDashboardChartCatalog();
    const tiles = catalog.filter(entry => entry.lane !== 'section:health').map(entry => entry.tile);
    user.settings.dashboardSettings.tiles = tiles;
    user.settings.appSettings = { dashboardChartLibrarySeen: { 'section:health': 2 } } as never;
    fixture.componentRef.setInput('seed', { tiles }); await settle();
    await component.toggle(); await settle();
    expect(component.browseLane()).toBe('section:health');
    await component.openSection('section:activityOverview', true); await settle();
    expect(component.filtered()).toEqual([]);
    expect(component.placeholderTitle()).toBe('Create your own chart');
    expect(button('Create custom chart')).toBeTruthy();
  });

  it('keeps a dirty Health selection when a dashboard section switch is declined', async () => {
    fixture.componentRef.setInput('allSections', true); await settle();
    await component.openSection('section:health', true); await settle();
    component.state.updateHealthSettings({ ...component.state.healthSettings()!, range: '90d' }, false);
    component.search.set('oxygen');
    await component.openSection('kpi', true); await settle();
    expect(component.browseLane()).toBe('section:health'); expect(component.search()).toBe('oxygen');
    expect(component.state.healthSettings()?.range).toBe('90d');
    discard = true;
    await component.openSection('kpi', true); await settle();
    expect(component.browseLane()).toBe('kpi'); expect(component.search()).toBe('');
  });

  it('uses the dashboard picker for editing a tile outside its default section without acknowledging new types', async () => {
    fixture.componentRef.setInput('allSections', true);
    fixture.componentRef.setInput('lane', 'section:activityOverview');
    const tile = getDashboardChartCatalog().find(entry => entry.definition.id === 'health:steps')!.tile;
    user.settings.dashboardSettings.tiles = [tile]; fixture.componentRef.setInput('seed', { tiles: [tile] }); await settle();
    await component.state.edit(user, tile.order); await settle();
    expect(component.expanded()).toBe(true); expect(component.browseLane()).toBe('section:health');
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(discovery.acknowledge).not.toHaveBeenCalled();
  });

  it('opens a Health pin preview without acknowledging the catalog or loading suggestions', async () => {
    const watch = vi.spyOn(TestBed.inject(DashboardHealthService), 'watch');
    fixture.componentRef.setInput('lane', 'section:health');
    const entry = getDashboardChartCatalog().find(item => item.definition.id === 'health:steps')!;
    await component.state.select(user, entry);
    component.state.pinnedFromHealth.set(true);
    component.state.activeLane.set('section:health');
    await settle();
    expect(discovery.acknowledge).not.toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
    expect(button('Back to charts')).toBeTruthy();
    await component.back(); await settle();
    expect(discovery.acknowledge).toHaveBeenCalledWith(user, 'section:health', 2);
    expect(watch).toHaveBeenCalledTimes(5);
  });

  it('searches across Health categories and keeps the badge inside the section edge', async () => {
    fixture.componentRef.setInput('lane', 'section:health');
    component.group.set('sleep'); component.search.set('weight'); fixture.detectChanges();
    expect(component.filtered().map(entry => entry.definition.id)).toEqual(['health:body_weight']);
    const trigger = fixture.nativeElement.querySelector('button');
    expect(trigger.getAttribute('matBadgePosition')).toBe('above before');
  });

  it('shows new types without fetching chart data and acknowledges only an opened browse list', async () => {
    const entry = component['catalog'].find(entry => entry.definition.id === 'kpi-acwr')!;
    entry.definition = { ...entry.definition, introducedIn: 2 };
    fixture.componentRef.setInput('seed', { tiles: [] }); await settle();
    expect(component.unseen()).toHaveLength(1);
    expect(component.addActionLabel()).toContain('1 new');
    // Material's small size is a dot and suppresses its text in the app's M3 theme.
    expect(fixture.nativeElement.querySelector('.mat-badge-medium .mat-badge-content')?.textContent).toContain('New');
    expect(derived.watch).not.toHaveBeenCalled();
    expect(discovery.acknowledge).not.toHaveBeenCalled();
    await component.toggle(); await settle();
    expect(discovery.acknowledge).toHaveBeenCalledWith(user, 'kpi', 2);
    expect(component.rowPreviews()[0].isNew).toBe(true);
    const refreshed = { ...user, settings: { ...user.settings, appSettings: { dashboardChartLibrarySeen: { kpi: 2 } } } };
    fixture.componentRef.setInput('user', refreshed); await settle();
    expect(component.unseen()).toHaveLength(0);
    expect(component.rowPreviews()[0].isNew).toBe(true);
    expect(derived.watch).toHaveBeenCalledOnce();
    await component.close(); await settle();
    await component.toggle(); await settle();
    expect(component.rowPreviews().some(entry => entry.isNew)).toBe(false);
    expect(discovery.acknowledge).toHaveBeenCalledOnce();
  });

  it('does not acknowledge new types when an existing tile is opened for editing', async () => {
    const entry = component['catalog'].find(entry => entry.definition.id === 'kpi-acwr')!;
    entry.definition = { ...entry.definition, introducedIn: 2 };
    const existing = component['catalog'].find(entry => entry.definition.id === 'kpi-form-now')!.tile;
    user.settings.dashboardSettings.tiles = [existing];
    fixture.componentRef.setInput('seed', { tiles: [existing] }); await settle();
    await component.state.edit(user, existing.order); await settle();
    expect(discovery.acknowledge).not.toHaveBeenCalled();
    expect(component.unseen()).toHaveLength(1);
    await component.back(); await settle();
    expect(discovery.acknowledge).toHaveBeenCalledWith(user, 'kpi', 2);
  });

  it('keeps browsing usable after acknowledgement fails and retries on the next opening', async () => {
    mobile = true;
    const entry = component['catalog'].find(entry => entry.definition.id === 'kpi-acwr')!;
    entry.definition = { ...entry.definition, introducedIn: 2 };
    fixture.componentRef.setInput('seed', { tiles: [] }); await settle();
    discovery.acknowledge.mockRejectedValueOnce(new Error('offline'));
    await component.toggle(); await settle();
    expect(component.state.busy()).toBe(false);
    expect(component.state.error()).toBe('');
    await component.select(component.rowPreviews()[0]); await settle();
    expect(component.state.draft()).toBeTruthy();
    await component.back(); await settle();
    expect(discovery.acknowledge).toHaveBeenCalledOnce();
    await component.close(); await settle();
    await component.toggle(); await settle();
    expect(discovery.acknowledge).toHaveBeenCalledTimes(2);
  });

  it('groups at most two ready suggestions without duplicating rows or changing a selected draft', async () => {
    const source$ = new Subject<ReturnType<typeof buildDashboardExampleEvents>>();
    events.getEventsBy.mockReturnValue(source$);
    fixture.componentRef.setInput('lane', 'section:activityOverview'); await settle();
    await component.toggle(); await settle();
    const selected = component.state.selected()?.definition.id;
    source$.next(buildDashboardExampleEvents(Date.now())); await settle();
    expect(component.suggested().map(entry => entry.definition.id)).toEqual(['custom-weekly-training-time', 'custom-duration-pie']);
    expect(new Set(component.rowPreviews().map(entry => entry.definition.id)).size).toBe(component.rowPreviews().length);
    expect(component.state.selected()?.definition.id).toBe(selected);
    expect(document.body.textContent).toContain('Suggested for you');
    component.filter('distance'); await settle();
    expect(component.suggested()).toHaveLength(0);
    expect(component.rowPreviews().every(entry => entry.definition.label.toLowerCase().includes('distance'))).toBe(true);
  });

  it('keeps Calendar as a single-purpose browse section without duplicate labels', async () => {
    fixture.componentRef.setInput('lane', 'section:calendar'); await settle();
    expect(component.available().map(entry => entry.definition.label)).toEqual(['Calendar']);
    await component.toggle(); await settle();
    expect(document.querySelector('.chart-library-heading h2')?.textContent?.trim()).toBe('Add Calendar');
    expect(component.backLabel()).toBe('Back to Calendar');
  });

  it('loads missing KPI data once per open picker, keeps filtering silent, and releases reads on close', async () => {
    const snapshots$ = new Subject<ReturnType<typeof createDashboardDerivedMetricsMissingState>>();
    derived.watch.mockReturnValue(snapshots$);
    expect(derived.watch).not.toHaveBeenCalled();
    await component.toggle(); await settle();
    expect(derived.watch).toHaveBeenCalledOnce();
    expect(component.rowPreviews()[0].preview.loading).toBe(true);
    const state = createDashboardDerivedMetricsMissingState();
    state.acwr = { ratio: 1.6, acuteLoad7: 160, chronicLoad28: 100, latestDayMs: 3,
      trend8Weeks: [{ time: 1, value: 1.2 }, { time: 3, value: 1.6 }] };
    snapshots$.next(state); await settle();
    const row = component.rowPreviews().find(entry => entry.definition.id === 'kpi-acwr')!;
    expect(row.preview.source).toBe('user');
    expect(row.preview.tile['acwr']).toEqual(state.acwr);
    expect(component.previewSeed().derivedMetrics?.acwr).toEqual(state.acwr);
    component.filter('ACWR'); await settle();
    expect(component.rowPreviews()[0]).toBe(row);
    expect(derived.watch).toHaveBeenCalledOnce();
    expect(derived.ensureForDashboard).not.toHaveBeenCalled();
    await component.close(); await settle();
    expect(snapshots$.observed).toBe(false);
    expect(component.previewSeed().derivedMetrics?.acwr).toBeUndefined();
  });
  it('drops another account’s fetched KPI data and unsubscribes before loading the new owner', async () => {
    const old$ = new Subject<ReturnType<typeof createDashboardDerivedMetricsMissingState>>();
    const next$ = new Subject<ReturnType<typeof createDashboardDerivedMetricsMissingState>>();
    derived.watch.mockReturnValueOnce(old$).mockReturnValueOnce(next$);
    await component.toggle(); await settle();
    const state = createDashboardDerivedMetricsMissingState();
    state.acwr = { ratio: 1.6, acuteLoad7: 160, chronicLoad28: 100, latestDayMs: 3, trend8Weeks: [] };
    old$.next(state); await settle();
    fixture.componentRef.setInput('user', { ...user, uid: 'next-owner' }); await settle();
    expect(old$.observed).toBe(false);
    expect(component.previewSeed().derivedMetrics?.acwr).toBeUndefined();
    expect(component.rowPreviews().find(entry => entry.definition.id === 'kpi-acwr')?.preview.source).toBe('example');
    expect(derived.watch).toHaveBeenLastCalledWith(expect.objectContaining({ uid: 'next-owner' }), expect.anything());
    fixture.destroy();
    expect(next$.observed).toBe(false);
  });
  it('hydrates all activity rows through one read and retains previews while searching', async () => {
    const source$ = new Subject<ReturnType<typeof buildDashboardExampleEvents>>();
    events.getEventsBy.mockReturnValue(source$);
    fixture.componentRef.setInput('lane', 'section:activityOverview'); await settle();
    await component.toggle(); await settle();
    expect(events.getEventsBy).toHaveBeenCalledOnce();
    expect(component.rowPreviews().every(row => row.preview.loading)).toBe(true);
    source$.next(buildDashboardExampleEvents(Date.now())); await settle();
    const rows = component.rowPreviews();
    expect(rows.every(row => row.preview.source === 'user' && !row.preview.loading)).toBe(true);
    component.filter('Distance'); await settle();
    expect(component.rowPreviews().every(row => rows.includes(row))).toBe(true);
    expect(events.getEventsBy).toHaveBeenCalledOnce();
    expect(derived.watch).not.toHaveBeenCalled();
    await component.close(); await settle();
    expect(source$.observed).toBe(false);
    expect(component.previewSeed().previewEventsByRange).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });
  it('keeps reused dashboard data live without fetching again or changing the selection', async () => {
    const existing = getDashboardChartCatalog().find(entry => entry.definition.id === 'custom-distance-columns')!.tile;
    user.settings.dashboardSettings.tiles = [existing];
    fixture.componentRef.setInput('lane', 'section:activityOverview');
    fixture.componentRef.setInput('seed', { tiles: [existing], tileEventsByOrder: { [existing.order]: buildDashboardExampleEvents(Date.now()) } });
    await settle(); await component.toggle(); await settle();
    const selected = component.state.selected()?.definition.id;
    expect(component.suggested()).toHaveLength(2);
    expect(events.getEventsBy).not.toHaveBeenCalled();

    fixture.componentRef.setInput('seed', { tiles: [existing], tileEventsByOrder: { [existing.order]: [] } });
    await settle();
    expect(component.suggested()).toHaveLength(0);
    expect(component.rowPreviews().every(row => row.preview.availability?.state === 'no-data')).toBe(true);
    expect(component.state.selected()?.definition.id).toBe(selected);
    expect(events.getEventsBy).not.toHaveBeenCalled();
  });
  it('opens a wide dialog without expanding the dashboard', async () => {
    await component.toggle(); await settle();
    expect(document.body.querySelector('mat-dialog-container')).not.toBeNull();
    expect(document.body.querySelector('.chart-library-dialog')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('mat-action-list')).toBeNull();
    expect(document.body.querySelector('.chart-library-detail')).not.toBeNull();
    expect(document.body.querySelectorAll('app-dashboard-chart-preview')).toHaveLength(1);
    expect(component.state.selected()?.definition.id).toBe(component.filtered()[0].definition.id);
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(TestBed.inject(MatDialog).open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ width: '1180px', disableClose: true }));
    expect(document.body.querySelector('.chart-library-heading h2')?.textContent).toContain('KPIs');
  });
  it('opens a nearly full-height bottom sheet on mobile and restores the entry focus when closed', async () => {
    mobile = true;
    const open = vi.spyOn(TestBed.inject(MatBottomSheet), 'open');
    const entry = button('Add KPI'); entry.focus();
    await component.toggle(); await settle();
    expect(document.body.querySelector('mat-bottom-sheet-container')).not.toBeNull();
    expect(document.body.querySelector('.chart-library-dialog')).toBeNull();
    expect(document.body.querySelector('mat-dialog-container')).toBeNull();
    expect(open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ height: '92dvh', disableClose: true }));
    await component.close(); await settle();
    await vi.waitFor(() => expect(document.body.querySelector('mat-bottom-sheet-container')).toBeNull());
    expect(document.activeElement).toBe(entry);
  });
  it('restores the tile action after editing even when the section has no add action', async () => {
    const maps = getDashboardChartCatalog().filter(entry => entry.lane === 'section:routesMaps');
    user.settings.dashboardSettings.tiles = maps.map((entry, order) => ({ ...entry.tile, order }));
    fixture.componentRef.setInput('lane', 'section:routesMaps');
    fixture.componentRef.setInput('seed', { tiles: user.settings.dashboardSettings.tiles }); await settle();
    const tile = document.createElement('div'); tile.dataset.dashboardTileOrder = '0';
    const trigger = document.createElement('button'); trigger.className = 'tile-actions-trigger';
    tile.append(trigger); document.body.append(tile);
    const menuItem = document.createElement('button'); document.body.append(menuItem); menuItem.focus();
    try {
      expect(fixture.nativeElement.querySelector('button')).toBeNull();
      await component.state.edit(user, 0); await settle(); menuItem.remove();
      await component.close(); await settle();
      await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
      expect(save).not.toHaveBeenCalled();
    } finally { tile.remove(); menuItem.remove(); }
  });
  it('returns mobile preview focus to the selected list row', async () => {
    mobile = true;
    await component.toggle(); await settle();
    const row = document.body.querySelectorAll<HTMLButtonElement>('.chart-library-list button')[4];
    row.click(); await settle();
    await component.back(); await settle();
    await vi.waitFor(() => expect(document.activeElement).toBe(row));
    expect(component.state.draft()).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
  it('guards backdrop dismissal and retains the picker when changes are kept', async () => {
    await component.toggle(); await component.select(component.filtered()[0]);
    component.state.editor()!.category = 'custom'; component.state.refreshDraft(); await settle();
    document.body.querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click(); await settle();
    expect(component.expanded()).toBe(true); expect(component.state.editor()).not.toBeNull();
    discard = true;
    document.body.querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click(); await settle();
    expect(component.expanded()).toBe(false); expect(document.body.querySelector('mat-dialog-container')).toBeNull();
  });
  it('closes the picker and releases preview views when the dashboard context changes', async () => {
    await component.toggle(); await component.select(component.filtered()[0]); await settle();
    component.state.resetContext(); await settle();
    expect(document.body.querySelector('mat-dialog-container')).toBeNull();
    expect(component.state.draft()).toBeNull();
  });
  it('starts selected previews at the top without scrolling their tall focused container into view', async () => {
    mobile = true;
    await component.toggle(); await settle();
    const content = document.body.querySelector<HTMLElement>('.chart-library-layout')!;
    content.scrollTop = 500;
    await component.select(component.filtered()[0]); await settle();
    await vi.waitFor(() => expect(content.scrollTop).toBe(0));
    expect(document.activeElement).toBe(document.body.querySelector('.chart-library-detail'));
    const detail = document.body.querySelector<HTMLElement>('.chart-library-detail')!;
    detail.scrollTop = 400;
    await component.select(component.filtered()[1]); await settle();
    await vi.waitFor(() => expect(detail.scrollTop).toBe(0));
  });
  it('lists all available charts without pagination and combines search with KPI groups', async () => {
    button('Add KPI').click(); await settle();
    expect(document.body.querySelectorAll('button[mat-list-item]')).toHaveLength(17);
    expect(document.body.querySelectorAll('button[mat-list-item] app-dashboard-chart-thumbnail')).toHaveLength(17);
    expect(document.body.querySelector('button[mat-list-item] [matListItemIcon]')).toBeNull();
    expect(document.body.querySelector('button[mat-list-item] [matListItemLine]')?.textContent).toContain('KPI · Example · Waiting for chart data');
    expect(document.body.querySelector('[aria-label="Next charts"]')).toBeNull();
    component.selectGroup('execution'); component.filter('aerobic'); await settle();
    expect(document.body.querySelectorAll('button[mat-list-item]')).toHaveLength(2);
    expect(document.body.querySelector('.chart-library-count')?.textContent).toContain('2 KPIs available');
    expect(save).not.toHaveBeenCalled();
  });
  it('selects a list row without saving and leaves an unchanged selection silent', async () => {
    await component.toggle(); await settle();
    haptics.selection.mockClear();
    const rows = document.body.querySelectorAll<HTMLButtonElement>('button[mat-list-item]');
    rows[1].click(); await settle();
    expect(rows[1].getAttribute('aria-pressed')).toBe('true');
    expect(rows[0].getAttribute('aria-pressed')).toBe('false');
    expect(component.state.selected()?.definition.id).toBe(component.filtered()[1].definition.id);
    rows[1].click(); await settle();
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(document.body.querySelectorAll('app-dashboard-chart-preview')).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
  });
  it('reuses thumbnail models while typing and refreshes them when loaded data changes', () => {
    const row = component.rowPreviews()[0];
    component.filter(row.definition.label);
    expect(component.rowPreviews()[0]).toBe(row);
    component.filter('');
    expect(component.rowPreviews()[0]).toBe(row);
    fixture.componentRef.setInput('seed', { tiles: [] });
    expect(component.rowPreviews()[0].preview).not.toBe(row.preview);
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('clears an excluded preview when filtering and does not offer to add a hidden choice', async () => {
    await component.toggle(); await settle();
    const selected = component.state.selected()!;
    const other = component.filtered().find(entry => entry.definition.id !== selected.definition.id)!;
    haptics.selection.mockClear();
    component.filter(other.definition.label); await settle();
    expect(component.filtered().some(entry => entry.definition.id === selected.definition.id)).toBe(false);
    expect(component.state.draft()).toBeNull();
    expect(button('Add to dashboard')).toBeUndefined();
    await component.select(other); await settle();
    component.filter('no matching chart'); await settle();
    expect(document.body.querySelector('.chart-library-empty')?.textContent).toContain('No KPIs match');
    expect(component.state.draft()).toBeNull();
    expect(button('Add to dashboard')).toBeUndefined();
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });
  it('retains the preview scroll position when the selected row is activated again', async () => {
    await component.toggle(); await settle();
    // Finish the initial focus callback before simulating a reader scrolling through details.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const detail = document.body.querySelector<HTMLElement>('.chart-library-detail')!;
    detail.scrollTop = 300;
    haptics.selection.mockClear();
    await component.select(component.state.selected()!); await settle();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(detail.scrollTop).toBe(300);
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it('retains matching previews but clears excluded previews when the KPI group changes', async () => {
    await component.toggle(); await settle();
    const draft = component.state.draft();
    haptics.selection.mockClear();
    component.filter('KPI'); component.selectGroup('load'); await settle();
    expect(component.state.draft()).toBe(draft);
    component.selectGroup('execution'); await settle();
    expect(component.filtered().length).toBeGreaterThan(0);
    expect(component.state.draft()).toBeNull();
    expect(button('Add to dashboard')).toBeUndefined();
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });
  it('opens details before adding, then updates availability after the saved layout arrives', async () => {
    mobile = true;
    button('Add KPI').click(); await settle(); (document.body.querySelector('button[mat-list-item]') as HTMLButtonElement).click(); await settle();
    expect(document.body.querySelector('.has-selection .chart-library-detail')).not.toBeNull();
    expect(button('Add to dashboard')).toBeDefined(); expect(save).not.toHaveBeenCalled();
    expect(component.dataScope()).toContain('recorded training data');
    expect(document.body.querySelectorAll('.chart-library-explanation p').length).toBeGreaterThan(1);
    button('Add to dashboard').click(); await settle();
    expect(save).toHaveBeenCalledTimes(1); expect(user.settings.dashboardSettings.tiles).toHaveLength(1);
    fixture.componentRef.setInput('seed', { tiles: user.settings.dashboardSettings.tiles }); await settle();
    expect(component.available()).toHaveLength(16); expect(component.state.undoAvailable()).toBe(true);
  });
  it('returns from details without mutation and keeps initialization and unchanged group selection silent', async () => {
    mobile = true;
    expect(haptics.selection).not.toHaveBeenCalled(); component.selectGroup('all'); expect(haptics.selection).not.toHaveBeenCalled();
    button('Add KPI').click(); await settle(); (document.body.querySelector('button[mat-list-item]') as HTMLButtonElement).click(); await settle();
    button('Back to KPIs').click(); await settle();
    expect(document.body.querySelector('.chart-library-detail')).toBeNull();
    expect(component.expanded()).toBe(true); expect(save).not.toHaveBeenCalled();
  });
  it('returns from mobile settings to the chart without discarding unsaved properties', async () => {
    mobile = true;
    fixture.componentRef.setInput('lane', 'section:activityOverview'); await settle();
    await component.toggle(); await component.select(component.filtered().find(entry => entry.definition.category === 'custom')!);
    component.configure(); await settle();
    const editor = component.state.editor()!;
    editor.customEventRange = '30d'; component.state.refreshDraft();
    const draft = component.state.draft();
    haptics.selection.mockClear();
    button('Back to chart').click(); await settle();
    expect(component.state.configuring()).toBe(false);
    expect(component.state.editor()).toBe(editor);
    expect(component.state.draft()).toBe(draft);
    expect(editor.customEventRange).toBe('30d');
    expect(button('Chart settings')).toBeDefined();
    expect(document.body.querySelector('app-dashboard-chart-preview')).not.toBeNull();
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    button('Chart settings').click(); await settle();
    expect(component.state.editor()).toBe(editor);
    component.state.busy.set(true); haptics.selection.mockClear();
    await component.back();
    expect(component.state.configuring()).toBe(true);
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('updates details to describe the configured chart instead of the original preset', async () => {
    const catalog = getDashboardChartCatalog();
    const distance = catalog.find(entry => entry.definition.id === 'custom-distance-columns')!;
    const map = catalog.find(entry => entry.definition.category === 'map' && entry.tile['mapSource'] === 'events')!;
    fixture.componentRef.setInput('lane', distance.lane);
    await component.toggle(); await component.select(distance);
    component.state.editor()!.onCategoryChange('map'); component.state.refreshDraft(); await settle();
    expect(document.body.querySelector('.chart-library-detail h3').textContent).toBe(map.definition.label);
    expect(component.explanation()).toBe(map.definition.description);
    expect(button('Map settings')).toBeDefined();
    component.configure(); await settle();
    expect(document.body.querySelector('.chart-library-properties h3')?.textContent).toBe('Map properties');
    expect(button('Back to map')).toBeDefined();
    await component.close();
    expect(TestBed.inject(MatDialog).open).toHaveBeenLastCalledWith(ConfirmationDialogComponent, expect.objectContaining({ data: expect.objectContaining({ title: 'Discard map changes?' }) }));
    expect(save).not.toHaveBeenCalled();
  });
  it.each(['kpi', 'section:trainingState', 'section:performancePower', 'section:routesMaps'])(
    'does not offer custom creation in %s', async (lane) => {
      fixture.componentRef.setInput('lane', lane);
      await component.toggle(); await settle();
      expect(button('Create custom chart')).toBeUndefined();
    },
  );
  it.each(['kpi', 'section:trainingState', 'section:performancePower', 'section:routesMaps'])(
    'hides the add action when %s is full and restores it when a preset is removed', async (lane) => {
      const entries = getDashboardChartCatalog().filter(entry => entry.lane === lane);
      fixture.componentRef.setInput('lane', lane);
      fixture.componentRef.setInput('seed', { tiles: entries.map(entry => entry.tile) });
      await settle();
      expect(fixture.nativeElement.querySelector('button')).toBeNull();
      expect(haptics.selection).not.toHaveBeenCalled();
      fixture.componentRef.setInput('seed', { tiles: entries.slice(1).map(entry => entry.tile) });
      await settle();
      expect(fixture.nativeElement.querySelector('button')?.textContent).toContain(component.sectionPresentation().add);
      expect(component.available()).toHaveLength(1);
    },
  );
  it('keeps fixed tile details available when the section has no add action', async () => {
    const entries = getDashboardChartCatalog().filter(entry => entry.lane === 'kpi');
    user.settings.dashboardSettings.tiles = entries.map((entry, order) => ({ ...entry.tile, order }));
    fixture.componentRef.setInput('seed', { tiles: user.settings.dashboardSettings.tiles });
    await settle();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    await component.state.edit(user, 0); await settle();
    expect(document.body.querySelector('.chart-library-heading h2')?.textContent).toContain('KPI details');
    expect(document.body.querySelector('.chart-library-properties')).toBeNull();
    expect(button('Save changes')).toBeUndefined();
    expect(button('KPI settings')).toBeUndefined();
  });
  it.each([
    ['kpi', 'Add KPI', 'KPIs'],
    ['section:calendar', 'Add calendar', 'calendars'],
    ['section:trainingState', 'Add chart', 'charts'],
    ['section:performancePower', 'Add chart', 'charts'],
    ['section:activityOverview', 'Add chart', 'charts'],
    ['section:routesMaps', 'Add map', 'maps'],
  ])('keeps %s labels stable as availability and filters change', async (lane, action, plural) => {
    fixture.componentRef.setInput('lane', lane); await settle();
    const entries = component.available();
    expect(fixture.nativeElement.querySelector('button')?.textContent).toContain(action);
    fixture.componentRef.setInput('seed', { tiles: entries.slice(1).map(entry => entry.tile) }); await settle();
    expect(fixture.nativeElement.querySelector('button')?.textContent).toContain(action);
    expect(component.availableCountLabel()).toBe(`1 ${component.sectionPresentation().singular} available`);
    component.filter('no matching entry');
    expect(component.availableCountLabel()).toBe(`0 ${plural} available`);
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it.each(['curated-activity-calendar', 'curated-recovery', 'curated-hrv', 'curated-sleep', 'kpi-acwr'])(
    'previews %s without offering settings or blocking Add', async id => {
      const entry = getDashboardChartCatalog().find(candidate => candidate.definition.id === id)!;
      expect(entry).toBeDefined();
      fixture.componentRef.setInput('lane', entry.lane); await settle();
      await component.toggle(); await component.select(entry); await settle();
      expect(document.body.querySelector('.chart-library-settings')).toBeNull();
      expect(button('Add to dashboard')).toBeDefined();
      haptics.selection.mockClear(); component.configure(); await settle();
      expect(component.state.configuring()).toBe(false);
      expect(haptics.selection).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    },
  );

  it('keeps custom creation available in Activity Overview when every preset is already added', async () => {
    fixture.componentRef.setInput('lane', 'section:activityOverview');
    fixture.componentRef.setInput('seed', { tiles: getDashboardChartCatalog().map(entry => entry.tile) });
    await settle();
    expect(component.available()).toHaveLength(0);
    expect(component.state.draft()).toBeNull();
    haptics.selection.mockClear();
    button('Add chart').click(); await settle();
    expect(component.state.configuring()).toBe(true);
    expect(document.body.querySelector('.chart-library-browser')).toBeNull();
    expect(document.body.querySelector('.chart-library-heading h2')?.textContent).toContain('Create custom chart');
    expect(document.body.querySelector('app-dashboard-tile-editor mat-radio-group')).toBeNull();
    expect(Array.from(document.body.querySelectorAll('app-dashboard-tile-editor mat-label')).map(label => label.textContent?.trim())).toEqual(['Chart type', 'Data type', 'Value aggregation', 'Category axis', 'Chart date range']);
    expect(component.destination()).toBe('Activity Overview');
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });
  it('opens properties from the visible settings action and returns to the chart', async () => {
    fixture.componentRef.setInput('lane', 'section:activityOverview'); await settle();
    await component.toggle(); await component.select(component.filtered().find(entry => entry.definition.category === 'custom')!); await settle();
    const settings = button('Chart settings');
    const preview = document.body.querySelector('.chart-library-preview')!;
    expect(settings.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    haptics.selection.mockClear();
    settings.click(); await settle();
    expect(document.body.querySelector('.chart-library-browser')).toBeNull();
    expect(document.body.querySelector('.chart-library-properties')).not.toBeNull();
    expect(haptics.selection).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(document.activeElement).toBe(document.body.querySelector('.chart-library-detail')));
    button('Back to chart').click(); await settle();
    expect(document.body.querySelector('.chart-library-browser')).not.toBeNull();
    expect(document.body.querySelector('.chart-library-properties')).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
  it('changes a custom property through its Material select and saves that choice', async () => {
    fixture.componentRef.setInput('lane', 'section:activityOverview');
    await component.toggle(); await component.createCustom(); await settle();
    const fields = Array.from(document.body.querySelectorAll('mat-form-field'));
    const typeField = fields.find(field => field.querySelector('mat-label')?.textContent?.trim() === 'Chart type')!;
    haptics.selection.mockClear();
    (typeField.querySelector('mat-select') as HTMLElement).click(); await settle();
    const pie = Array.from(document.body.querySelectorAll('mat-option')).find(option => option.textContent?.trim() === 'Pie')!;
    (pie as HTMLElement).click(); await settle();
    expect(component.state.draft()?.['chartType']).toBe('Pie');
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(document.body.querySelector('.chart-library-properties')?.textContent).not.toContain('Value aggregation');
    expect(save).not.toHaveBeenCalled();
    button('Add to dashboard').click(); await settle();
    expect(user.settings.dashboardSettings.tiles[0]['chartType']).toBe('Pie');
    expect(save).toHaveBeenCalledOnce();
  });
  it('asks only once when cancelling closure of a dirty custom chart', async () => {
    const open = vi.spyOn(TestBed.inject(MatDialog), 'open');
    fixture.componentRef.setInput('lane', 'section:activityOverview');
    await component.toggle(); await settle();
    button('Create custom chart').click(); await settle(); open.mockClear();
    component.state.editor()!.customEventRange = '30d'; component.state.refreshDraft();
    await component.toggle();
    expect(open).toHaveBeenCalledOnce(); expect(component.expanded()).toBe(true);
    expect(component.state.editor()!.customEventRange).toBe('30d');
  });
  it('locks chart settings until the pending save completes', async () => {
    let resolve!: () => void; save.mockReturnValueOnce(new Promise<void>(done => resolve = done));
    fixture.componentRef.setInput('lane', 'section:activityOverview'); await settle();
    await component.toggle(); await component.select(component.filtered().find(entry => entry.definition.category === 'custom')!); component.state.configure(); await settle();
    const saving = component.state.save(); fixture.detectChanges();
    expect(document.body.querySelector('app-dashboard-tile-editor').hasAttribute('inert')).toBe(true);
    expect(button('Saving…').disabled).toBe(true);
    document.body.querySelector<HTMLElement>('mat-dialog-container')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await component.close(); fixture.detectChanges();
    expect(component.expanded()).toBe(true);
    resolve(); await saving; await settle();
    expect(document.body.querySelector('.chart-library-detail')).toBeNull();
  });
  it('locks list filters during a pending save and restores them when the save fails', async () => {
    let reject!: (reason: Error) => void;
    save.mockReturnValueOnce(new Promise<void>((_resolve, fail) => reject = fail));
    await component.toggle(); await settle();
    const draft = component.state.draft();
    const saving = component.state.save(); await settle();
    const input = document.body.querySelector<HTMLInputElement>('.chart-library-browser input')!;
    expect(input.disabled).toBe(true);
    expect(document.body.querySelector('mat-chip-listbox')?.getAttribute('aria-disabled')).toBe('true');
    haptics.selection.mockClear();
    component.filter('no matching chart'); component.selectGroup('execution'); await settle();
    expect(component.search()).toBe(''); expect(component.group()).toBe('all');
    expect(component.state.draft()).toBe(draft);
    expect(haptics.selection).not.toHaveBeenCalled();
    reject(new Error('Save failed')); await saving; await settle();
    expect(input.disabled).toBe(false);
    expect(document.body.querySelector('mat-chip-listbox')?.getAttribute('aria-disabled')).not.toBe('true');
    expect(component.state.draft()).toBe(draft);
    expect(button('Add to dashboard').disabled).toBe(false);
  });
  it('keeps a failed save visible beside the retry action even when details are long', async () => {
    save.mockRejectedValueOnce(new Error('Save failed'));
    await component.toggle(); await component.select(component.filtered()[0]); await settle();
    await component.state.save(); await settle();
    expect(component.expanded()).toBe(true);
    expect(document.body.querySelector('.chart-library-save [role="alert"]')?.textContent).toContain('Could not save');
    expect(button('Add to dashboard').disabled).toBe(false);
    expect(component.state.draft()).not.toBeNull();
  });
});
