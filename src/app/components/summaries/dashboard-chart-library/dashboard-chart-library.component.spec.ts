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
});
