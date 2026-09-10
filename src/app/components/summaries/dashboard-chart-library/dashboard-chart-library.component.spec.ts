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
    await TestBed.configureTestingModule({ declarations: [DashboardChartLibraryComponent], imports: [MaterialModule, NoopAnimationsModule], schemas: [NO_ERRORS_SCHEMA], providers: [
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
    expect(fixture.nativeElement.querySelector('mat-card')).toBeNull();
    expect(TestBed.inject(MatDialog).open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ width: '1180px', disableClose: true }));
    expect(document.body.querySelector('.chart-library-heading h2')?.textContent).toContain('KPIs');
  });
  it('opens a nearly full-height bottom sheet on mobile and restores the entry focus when closed', async () => {
    mobile = true;
    const open = vi.spyOn(TestBed.inject(MatBottomSheet), 'open');
    const entry = button('Add charts'); entry.focus();
    await component.toggle(); await settle();
    expect(document.body.querySelector('mat-bottom-sheet-container')).not.toBeNull();
    expect(document.body.querySelector('mat-dialog-container')).toBeNull();
    expect(open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ height: '92dvh', disableClose: true }));
    await component.close(); await settle();
    await vi.waitFor(() => expect(document.body.querySelector('mat-bottom-sheet-container')).toBeNull());
    expect(document.activeElement).toBe(entry);
  });
  it('guards backdrop dismissal and retains the picker when changes are kept', async () => {
    await component.toggle(); await component.select(component.visible()[0]);
    component.state.editor()!.category = 'custom'; component.state.refreshDraft(); await settle();
    document.body.querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click(); await settle();
    expect(component.expanded()).toBe(true); expect(component.state.editor()).not.toBeNull();
    discard = true;
    document.body.querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click(); await settle();
    expect(component.expanded()).toBe(false); expect(document.body.querySelector('mat-dialog-container')).toBeNull();
  });
  it('closes the picker and releases preview views when the dashboard context changes', async () => {
    await component.toggle(); await component.select(component.visible()[0]); await settle();
    component.state.resetContext(); await settle();
    expect(document.body.querySelector('mat-dialog-container')).toBeNull();
    expect(component.state.draft()).toBeNull();
  });
  it('starts selected previews at the top without scrolling their tall focused container into view', async () => {
    await component.toggle(); await settle();
    const content = document.body.querySelector<HTMLElement>('.chart-library-layout')!;
    content.scrollTop = 500;
    await component.select(component.visible()[0]); await settle();
    await vi.waitFor(() => expect(content.scrollTop).toBe(0));
    expect(document.activeElement).toBe(document.body.querySelector('.chart-library-detail'));
    const detail = document.body.querySelector<HTMLElement>('.chart-library-detail')!;
    detail.scrollTop = 400;
    await component.select(component.visible()[1]); await settle();
    await vi.waitFor(() => expect(detail.scrollTop).toBe(0));
  });
  it('pages a large section and combines search with KPI groups', async () => {
    button('Add charts').click(); await settle();
    expect(document.body.querySelectorAll('mat-card')).toHaveLength(6);
    expect(component.totalPages()).toBe(3);
    document.body.querySelector<HTMLElement>('.chart-library-layout')!.scrollTop = 500;
    (document.body.querySelector('[aria-label="Next charts"]') as HTMLButtonElement).click(); await settle();
    expect(component.currentPage()).toBe(1);
    await vi.waitFor(() => expect(document.body.querySelector<HTMLElement>('.chart-library-layout')!.scrollTop).toBe(0));
    component.selectGroup('execution'); component.filter('aerobic'); await settle();
    expect(document.body.querySelectorAll('mat-card')).toHaveLength(2);
    expect(component.currentPage()).toBe(0); expect(save).not.toHaveBeenCalled();
  });
  it('opens details before adding, then updates availability after the saved layout arrives', async () => {
    button('Add charts').click(); await settle(); button('Preview & details').click(); await settle();
    expect(document.body.querySelector('.has-selection .chart-library-detail')).not.toBeNull();
    expect(button('Add to dashboard')).toBeDefined(); expect(save).not.toHaveBeenCalled();
    expect(component.dataScope()).toContain('training snapshots');
    button('Add to dashboard').click(); await settle();
    expect(save).toHaveBeenCalledTimes(1); expect(user.settings.dashboardSettings.tiles).toHaveLength(1);
    fixture.componentRef.setInput('seed', { tiles: user.settings.dashboardSettings.tiles }); await settle();
    expect(component.available()).toHaveLength(16); expect(component.state.undoAvailable()).toBe(true);
  });
  it('returns from details without mutation and keeps initialization and unchanged group selection silent', async () => {
    expect(haptics.selection).not.toHaveBeenCalled(); component.selectGroup('all'); expect(haptics.selection).not.toHaveBeenCalled();
    button('Add charts').click(); await settle(); button('Preview & details').click(); await settle();
    button('Back to charts').click(); await settle();
    expect(document.body.querySelector('.chart-library-detail')).toBeNull();
    expect(component.expanded()).toBe(true); expect(save).not.toHaveBeenCalled();
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
    expect(save).not.toHaveBeenCalled();
  });
  it.each(['kpi', 'section:trainingState', 'section:performancePower', 'section:routesMaps'])(
    'does not offer custom creation in %s', async (lane) => {
      fixture.componentRef.setInput('lane', lane);
      await component.toggle(); await settle();
      expect(button('Create custom chart')).toBeUndefined();
    },
  );
  it('keeps custom creation available in Activity Overview when every preset is already added', async () => {
    fixture.componentRef.setInput('lane', 'section:activityOverview');
    fixture.componentRef.setInput('seed', { tiles: getDashboardChartCatalog().map(entry => entry.tile) });
    await component.toggle(); await settle();
    expect(component.available()).toHaveLength(0);
    expect(component.state.draft()).toBeNull();
    haptics.selection.mockClear();
    button('Create custom chart').click(); await settle();
    expect(component.state.configuring()).toBe(true);
    expect(component.destination()).toBe('Activity Overview');
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
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
    await component.toggle(); await component.select(component.visible()[0]); component.state.configure(); await settle();
    const saving = component.state.save(); fixture.detectChanges();
    expect(document.body.querySelector('app-dashboard-tile-editor').hasAttribute('inert')).toBe(true);
    expect(button('Saving…').disabled).toBe(true);
    document.body.querySelector<HTMLElement>('mat-dialog-container')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await component.close(); fixture.detectChanges();
    expect(component.expanded()).toBe(true);
    resolve(); await saving; await settle();
    expect(document.body.querySelector('.chart-library-detail')).toBeNull();
  });
  it('keeps a failed save visible beside the retry action even when details are long', async () => {
    save.mockRejectedValueOnce(new Error('Save failed'));
    await component.toggle(); await component.select(component.visible()[0]); await settle();
    await component.state.save(); await settle();
    expect(component.expanded()).toBe(true);
    expect(document.body.querySelector('.chart-library-save [role="alert"]')?.textContent).toContain('Could not save');
    expect(button('Add to dashboard').disabled).toBe(false);
    expect(component.state.draft()).not.toBeNull();
  });
});
