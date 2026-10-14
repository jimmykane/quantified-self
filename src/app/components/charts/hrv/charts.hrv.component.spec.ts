import { Component, Input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsHrvComponent } from './charts.hrv.component';
import { HealthMetricSeriesChartComponent } from '../../health/health-metric-series-chart.component';
import { getDashboardChartCatalog } from '../../../helpers/dashboard-chart-catalog.helper';
import { buildDashboardExamplePreview } from '../../../helpers/dashboard-chart-preview.helper';
import type { DashboardChartTileViewModel } from '../../../helpers/dashboard-tile-view-model.helper';
import { buildDashboardHrvContext, type DashboardHrvContext } from '../../../helpers/dashboard-hrv-context.helper';
import { projectLoadedHealthRange } from '@shared/health-query';
import { AppHapticsService } from '../../../services/app.haptics.service';

@Component({ selector: 'app-health-metric-series-chart', standalone: true, template: '' })
class HealthChartStub {
  @Input() fillHeight: boolean; @Input() model: unknown; @Input() startTimeMs: number; @Input() endTimeMs: number;
  @Input() statusOverlay: unknown; @Input() statusDescription: string;
  @Input() unitSettings: unknown; @Input() darkTheme: boolean; @Input() timelineNotes: unknown;
}

describe('dashboard HRV chart', () => {
  const haptics = { selection: vi.fn() };
  let context: DashboardHrvContext;
  beforeEach(async () => {
    vi.clearAllMocks();
    const tile = getDashboardChartCatalog().find(entry => entry.definition.id === 'curated-hrv')!.tile;
    context = (buildDashboardExamplePreview(tile).tile as DashboardChartTileViewModel).hrvTrend!;
    await TestBed.configureTestingModule({ providers: [provideNoopAnimations(), { provide: AppHapticsService, useValue: haptics }] })
      .overrideComponent(ChartsHrvComponent, { remove: { imports: [HealthMetricSeriesChartComponent] }, add: { imports: [HealthChartStub] } }).compileComponents();
  });
  it('passes the actual Health model and range overlay to the existing renderer', () => {
    const fixture = TestBed.createComponent(ChartsHrvComponent);
    fixture.componentRef.setInput('context', context); fixture.detectChanges();
    const chart = fixture.debugElement.query(By.directive(HealthChartStub)).componentInstance as HealthChartStub;
    expect(chart.fillHeight).toBe(true);
    expect(chart.model).toBe(context.charts[0].model);
    expect(chart.statusOverlay).toBe(context.charts[0].statusOverlay);
    expect(chart.startTimeMs).toBe(context.window.startTimeMs);
    expect(chart.endTimeMs).toBe(context.window.endTimeMs);
    expect(fixture.nativeElement.textContent).toContain(context.charts[0].status!.detailText);
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('exposes the chart explanation through the same accessible info action as other tiles', () => {
    const fixture = TestBed.createComponent(ChartsHrvComponent);
    fixture.componentRef.setInput('context', context);
    fixture.componentRef.setInput('infoTooltip', 'Recorded HRV with your personal range.');
    fixture.componentRef.setInput('reserveTitleActionSpace', true); fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button[aria-label="How this chart is calculated"]');
    expect(button).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.hrv-title-row.hrv-reserve-actions')).not.toBeNull();
    expect(haptics.selection).not.toHaveBeenCalled();
    button.click(); expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('honors Health’s preferred source and gives feedback only on a changed selection', () => {
    const first = context.charts[0];
    context.charts.push({ ...first, key: 'another-source', model: { ...first.model, series: { ...first.model.series, id: 'another-source', sourceLabel: 'Another source' } } });
    const fixture = TestBed.createComponent(ChartsHrvComponent);
    fixture.componentRef.setInput('context', context); fixture.componentRef.setInput('preferredSource', 'another-source'); fixture.detectChanges();
    expect(fixture.componentInstance.chart()?.key).toBe('another-source');
    fixture.componentInstance.selectSource(1); fixture.componentInstance.selectSource(20);
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.componentInstance.selectSource(0);
    expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('keeps the mounted chart and its original axes while another range loads or fails', () => {
    const fixture = TestBed.createComponent(ChartsHrvComponent);
    fixture.componentRef.setInput('context', context); fixture.detectChanges();
    const original = fixture.debugElement.query(By.directive(HealthChartStub)).componentInstance;
    const requestedWindow = { ...context.window, label: 'Requested window', startTimeMs: context.window.startTimeMs - 86400000 };
    for (const state of [{ loading: true, error: false }, { loading: false, error: true }]) {
      fixture.componentRef.setInput('context', { ...context, ...state, requestedWindow }); fixture.detectChanges();
      const chart = fixture.debugElement.query(By.directive(HealthChartStub)).componentInstance;
      expect(chart).toBe(original);
      expect(chart.startTimeMs).toBe(context.window.startTimeMs);
      expect(fixture.nativeElement.querySelector('.hrv-window').textContent).toContain(context.window.label);
      expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Previous chart shown');
    }
    fixture.componentRef.setInput('context', context); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('selects each HRV variant from the same account and emits one pulse for a changed tab', () => {
    const empty = projectLoadedHealthRange([], [], { startDate: context.window.startDate, endDate: context.window.endDate,
      metricIds: ['heart_rate_variability'] }, { sourceRecordsComplete: true, samplesComplete: true });
    const endTimeMs = context.window.endTimeMs - 3_600_000;
    context = buildDashboardHrvContext(empty, empty, [{ id: 'night', userID: 'owner',
      source: { provider: 'GarminAPI', providerUserId: 'account', sourceSessionKey: 'night' },
      sleepDate: context.window.endDate, startTimeMs: endTimeMs - 8 * 3_600_000, endTimeMs,
      durationSeconds: 28_800, isNap: false, stages: [], stageDurationsSeconds: {},
      vitals: { averageHrvMs: 40, overnightHrvMs: 44 }, createdAtMs: endTimeMs, updatedAtMs: endTimeMs,
    }], context.window);
    const fixture = TestBed.createComponent(ChartsHrvComponent);
    fixture.componentRef.setInput('context', context); fixture.detectChanges();
    fixture.componentInstance.selectSource(1); fixture.detectChanges();
    expect(fixture.componentInstance.selectedIndex()).toBe(1);
    const rendered = fixture.debugElement.query(By.directive(HealthChartStub)).componentInstance as HealthChartStub;
    expect(rendered.model).toBe(context.charts[1].model);
    expect(haptics.selection).toHaveBeenCalledOnce();
    fixture.componentInstance.selectSource(1);
    expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('restores a preferred account when chart keys identify individual HRV variants', () => {
    const first = context.charts[0];
    const preferred = { ...first, key: 'other-series', model: { ...first.model,
      series: { ...first.model.series, id: 'other-series', sourceSelectionKey: 'preferred-account' } } };
    context.charts.push(preferred);
    const fixture = TestBed.createComponent(ChartsHrvComponent);
    fixture.componentRef.setInput('context', context);
    fixture.componentRef.setInput('preferredSource', 'preferred-account'); fixture.detectChanges();
    expect(fixture.componentInstance.chart()).toBe(preferred);
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('shows initial loading, errors and confirmed empty windows without an old chart', () => {
    const fixture = TestBed.createComponent(ChartsHrvComponent);
    for (const value of [{ ...context, charts: [], loading: true }, { ...context, charts: [], error: true }, { ...context, charts: [] }]) {
      fixture.componentRef.setInput('context', value); fixture.detectChanges();
      expect(fixture.debugElement.query(By.directive(HealthChartStub))).toBeNull();
      expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();
    }
  });
});
