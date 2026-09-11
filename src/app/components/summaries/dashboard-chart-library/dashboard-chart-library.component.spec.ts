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
import { of } from 'rxjs';
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
import { getDashboardChartCatalog } from '../../../helpers/dashboard-chart-catalog.helper';

describe('responsive chart picker interactions', () => {
  let fixture: ComponentFixture<DashboardChartLibraryComponent>;
  let component: DashboardChartLibraryComponent;
  let user: AppUserInterface;
  let mobile = false;
  let discard = false;
  const save = vi.fn();
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  const settle = async () => {
    // Material portals attach outside the fixture; flush their async click handlers before checking both views.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    fixture.detectChanges(); await fixture.whenStable();
  };
  const button = (label: string): HTMLButtonElement => Array.from(document.body.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(element => element.textContent?.includes(label))!;
  beforeEach(async () => {
    vi.restoreAllMocks(); vi.clearAllMocks(); mobile = false; discard = false; save.mockResolvedValue(undefined);
    await TestBed.configureTestingModule({ declarations: [DashboardChartLibraryComponent, DashboardTileEditorComponent], imports: [CommonModule, MaterialModule, NoopAnimationsModule], schemas: [NO_ERRORS_SCHEMA], providers: [
      DashboardChartLibraryState, { provide: DashboardConfigurationService, useValue: { save } }, { provide: AppHapticsService, useValue: haptics },
      { provide: BreakpointObserver, useValue: { isMatched: () => mobile, observe: () => of({ matches: false, breakpoints: {} }) } },
      { provide: AppEventService, useValue: {} }, { provide: AppSleepService, useValue: {} }, { provide: AppRouteService, useValue: {} }, { provide: DashboardDerivedMetricsService, useValue: {} },
    ] }).compileComponents();
    const dialog = TestBed.inject(MatDialog);
    const realOpen = dialog.open.bind(dialog);
    vi.spyOn(dialog, 'open').mockImplementation((target, options) => target === ConfirmationDialogComponent
      ? { afterClosed: () => of(discard) } as never : realOpen(target, options));
    user = { uid: 'test-owner', settings: { unitSettings: { speedUnits: [] }, dashboardSettings: { tiles: [] } } } as unknown as AppUserInterface;
    fixture = TestBed.createComponent(DashboardChartLibraryComponent); component = fixture.componentInstance;
    fixture.componentRef.setInput('user', user); fixture.componentRef.setInput('lane', 'kpi'); fixture.componentRef.setInput('seed', { tiles: [] }); fixture.detectChanges();
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
    expect(document.body.querySelector('button[mat-list-item] [matListItemLine]')?.textContent).toContain('KPI · Example data');
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
    ['section:trainingState', 'Add chart', 'charts'],
    ['section:performancePower', 'Add chart', 'charts'],
    ['section:activityOverview', 'Add tile', 'tiles'],
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
    button('Add tile').click(); await settle();
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
