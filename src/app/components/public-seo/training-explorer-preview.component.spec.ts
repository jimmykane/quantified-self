import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AppThemes } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppThemeService } from '../../services/app.theme.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { TrainingMixDetailsComponent } from '../shared/training-summary/training-mix-details.component';
import { TrainingBuildMetricsComponent } from '../shared/training-summary/training-build-metrics.component';
import { TrainingReadinessTrendChartComponent } from '../training/training-readiness-trend-chart.component';
import { TrainingPowerSystemsTrendChartComponent } from '../training/training-power-systems-trend-chart.component';
import { TrainingDurabilityTrajectoryChartComponent } from '../training/training-durability-trajectory-chart.component';
import { TrainingExplorerPreviewComponent } from './training-explorer-preview.component';

describe('TrainingExplorerPreviewComponent', () => {
  const theme = signal(AppThemes.Normal);
  const haptics = { selection: vi.fn() };
  const loader = {
    init: vi.fn().mockResolvedValue({ dispatchAction: vi.fn(), isDisposed: () => false }),
    setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
    subscribeToViewportResize: vi.fn(() => vi.fn()), attachMobileSeriesTapFeedback: vi.fn(() => vi.fn()),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    theme.set(AppThemes.Normal);
    await TestBed.configureTestingModule({
      imports: [TrainingExplorerPreviewComponent, NoopAnimationsModule],
      providers: [
        { provide: AppThemeService, useValue: { appTheme: theme } },
        { provide: AppHapticsService, useValue: haptics },
        { provide: EChartsLoaderService, useValue: loader },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('shares the actual Training views and mounts charts only for the active tab', async () => {
    const fixture = TestBed.createComponent(TrainingExplorerPreviewComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.debugElement.query(By.directive(TrainingMixDetailsComponent))).toBeTruthy();
    expect(loader.init).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.componentInstance.selectSport('Running');
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(TrainingMixDetailsComponent)).componentInstance.view().label).toBe('Running');
    fixture.componentInstance.selectSport('Running');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    for (const [tab, component, count] of [
      [1, TrainingBuildMetricsComponent, 1],
      [2, TrainingPowerSystemsTrendChartComponent, 3],
      [3, TrainingDurabilityTrajectoryChartComponent, 1],
    ] as const) {
      fixture.componentInstance.selectTab(tab);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(fixture.debugElement.queryAll(By.directive(component))).toHaveLength(count);
    }
    fixture.componentInstance.selectTab(3);
    fixture.componentInstance.selectTab(-1);
    expect(haptics.selection).toHaveBeenCalledTimes(4);
    expect(fixture.nativeElement.querySelector('div[data-nosnippet]')).toBeTruthy();
    expect(loader.attachMobileSeriesTapFeedback).toHaveBeenCalled();
    fixture.destroy();
    expect(loader.dispose).toHaveBeenCalled();
  });

  it('uses the production readiness chart and follows the app theme', async () => {
    const fixture = TestBed.createComponent(TrainingExplorerPreviewComponent);
    fixture.componentRef.setInput('kind', 'readiness');
    fixture.detectChanges();
    await fixture.whenStable();
    const chart = fixture.debugElement.query(By.directive(TrainingReadinessTrendChartComponent)).componentInstance;
    expect(chart.points).toHaveLength(14);
    expect(chart.darkTheme).toBe(false);
    theme.set(AppThemes.Dark);
    fixture.detectChanges();
    expect(chart.darkTheme).toBe(true);
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('mat-tab-group')).toBeNull();
  });
});
