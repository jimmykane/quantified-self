import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
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

describe('inline chart library interactions', () => {
  let fixture: ComponentFixture<DashboardChartLibraryComponent>;
  let component: DashboardChartLibraryComponent;
  let user: AppUserInterface;
  const save = vi.fn();
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  const settle = async () => { await fixture.whenStable(); fixture.detectChanges(); };
  const button = (label: string): HTMLButtonElement => Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(element => element.textContent?.includes(label))!;
  beforeEach(async () => {
    vi.clearAllMocks(); save.mockResolvedValue(undefined);
    await TestBed.configureTestingModule({ declarations: [DashboardChartLibraryComponent], imports: [MaterialModule, NoopAnimationsModule], schemas: [NO_ERRORS_SCHEMA], providers: [
      DashboardChartLibraryState, { provide: DashboardConfigurationService, useValue: { save } }, { provide: AppHapticsService, useValue: haptics },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(false) }) } },
      { provide: AppEventService, useValue: {} }, { provide: AppSleepService, useValue: {} }, { provide: AppRouteService, useValue: {} }, { provide: DashboardDerivedMetricsService, useValue: {} },
    ] }).compileComponents();
    user = { uid: 'test-owner', settings: { unitSettings: { speedUnits: [] }, dashboardSettings: { tiles: [] } } } as unknown as AppUserInterface;
    fixture = TestBed.createComponent(DashboardChartLibraryComponent); component = fixture.componentInstance;
    fixture.componentRef.setInput('user', user); fixture.componentRef.setInput('lane', 'kpi'); fixture.componentRef.setInput('seed', { tiles: [] }); fixture.detectChanges();
  });
  it('pages a large section and combines search with KPI groups', async () => {
    button('Add charts').click(); await settle();
    expect(fixture.nativeElement.querySelectorAll('mat-card')).toHaveLength(6);
    expect(component.totalPages()).toBe(3);
    (fixture.nativeElement.querySelector('[aria-label="Next charts"]') as HTMLButtonElement).click(); await settle();
    expect(component.currentPage()).toBe(1);
    component.selectGroup('execution'); component.filter('aerobic'); await settle();
    expect(fixture.nativeElement.querySelectorAll('mat-card')).toHaveLength(2);
    expect(component.currentPage()).toBe(0); expect(save).not.toHaveBeenCalled();
  });
  it('opens details before adding, then updates availability after the saved layout arrives', async () => {
    button('Add charts').click(); await settle(); button('Preview & details').click(); await settle();
    expect(fixture.nativeElement.querySelector('.has-selection .chart-library-detail')).not.toBeNull();
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
    expect(fixture.nativeElement.querySelector('.chart-library-detail')).toBeNull();
    expect(component.expanded()).toBe(true); expect(save).not.toHaveBeenCalled();
  });
  it('updates details to describe the configured chart instead of the original preset', async () => {
    const catalog = getDashboardChartCatalog();
    const distance = catalog.find(entry => entry.definition.id === 'custom-distance-columns')!;
    const map = catalog.find(entry => entry.definition.category === 'map' && entry.tile['mapSource'] === 'events')!;
    fixture.componentRef.setInput('lane', distance.lane);
    await component.toggle(); await component.select(distance);
    component.state.editor()!.onCategoryChange('map'); component.state.refreshDraft(); await settle();
    expect(fixture.nativeElement.querySelector('.chart-library-detail h3').textContent).toBe(map.definition.label);
    expect(component.explanation()).toBe(map.definition.description);
    expect(save).not.toHaveBeenCalled();
  });
  it('asks only once when cancelling closure of a dirty custom chart', async () => {
    const open = vi.spyOn(TestBed.inject(MatDialog), 'open');
    fixture.componentRef.setInput('lane', 'section:custom');
    await component.toggle();
    component.state.editor()!.customEventRange = '30d'; component.state.refreshDraft();
    await component.toggle();
    expect(open).toHaveBeenCalledOnce(); expect(component.expanded()).toBe(true);
    expect(component.state.editor()!.customEventRange).toBe('30d');
  });
  it('locks chart settings until the pending save completes', async () => {
    let resolve!: () => void; save.mockReturnValueOnce(new Promise<void>(done => resolve = done));
    await component.toggle(); await component.select(component.visible()[0]); component.state.configure(); await settle();
    const saving = component.state.save(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-dashboard-tile-editor').hasAttribute('inert')).toBe(true);
    expect(button('Saving…').disabled).toBe(true);
    resolve(); await saving; await settle();
    expect(fixture.nativeElement.querySelector('.chart-library-detail')).toBeNull();
  });
});
