import { BreakpointObserver } from '@angular/cdk/layout';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AppThemes } from '@sports-alliance/sports-lib';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsKpiComponent } from '../charts/kpi/charts.kpi.component';
import {
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
} from '../../helpers/dashboard-special-chart-types';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppThemeService } from '../../services/app.theme.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { HomeDashboardPreviewComponent } from './home-dashboard-preview.component';

describe('HomeDashboardPreviewComponent', () => {
  let fixture: ComponentFixture<HomeDashboardPreviewComponent>;
  const chart = {
    dispatchAction: vi.fn(),
    isDisposed: vi.fn(() => false),
    on: vi.fn(),
    off: vi.fn(),
  };
  const loader = {
    init: vi.fn().mockResolvedValue(chart),
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    subscribeToViewportResize: vi.fn(() => vi.fn()),
    attachMobileSeriesTapFeedback: vi.fn(() => vi.fn()),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [HomeDashboardPreviewComponent, NoopAnimationsModule],
      providers: [
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Normal) } },
        { provide: AppHapticsService, useValue: { selection: vi.fn() } },
        { provide: BreakpointObserver, useValue: { observe: vi.fn(() => of({ matches: false, breakpoints: {} })) } },
        { provide: EChartsLoaderService, useValue: loader },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeDashboardPreviewComponent);
  });

  it('reuses three real compact Dashboard KPI components with illustrative contexts', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(3));

    const kpiComponents = fixture.debugElement
      .queryAll(By.directive(ChartsKpiComponent))
      .map(debugElement => debugElement.componentInstance as ChartsKpiComponent);
    const text = fixture.nativeElement.textContent as string;

    expect(kpiComponents.map(component => component.chartType)).toEqual([
      DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
      DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
      DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
    ]);
    expect(kpiComponents.every(component => component.compactRow)).toBe(true);
    expect(kpiComponents.map(component => component.primaryValueText)).toEqual(['62', '+8', '72%']);
    expect(text).toContain('Training preset');
    expect(text).toContain('Curated');
    expect(text).toContain('KPI');
    expect(text).toContain('Custom');
    expect(text).toContain('Map');
  });
});
