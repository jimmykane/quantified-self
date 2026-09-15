import { ElementRef, SimpleChange } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TrainingReadinessTrendChartComponent } from '../components/training/training-readiness-trend-chart.component';
import { TrainingBodyWeightTrendChartComponent } from '../components/training/training-body-weight-trend-chart.component';
import { TrainingPowerSystemsTrendChartComponent } from '../components/training/training-power-systems-trend-chart.component';
import { TrainingDurabilityTrajectoryChartComponent } from '../components/training/training-durability-trajectory-chart.component';
import { TrainingSwimPerformanceChartComponent } from '../components/training/training-swim-performance-chart.component';
import { ChartsFormComponent } from '../components/charts/form/charts.form.component';
import { ChartsFreshnessForecastComponent } from '../components/charts/freshness-forecast/charts.freshness-forecast.component';
import { ChartsSleepTrendComponent } from '../components/charts/sleep-trend/charts.sleep-trend.component';
import { HealthMetricSeriesChartComponent } from '../components/health/health-metric-series-chart.component';

describe('explicit Timeline note chart adapters', () => {
  it.each([
    [TrainingReadinessTrendChartComponent, 'refresh', false],
    [TrainingBodyWeightTrendChartComponent, 'refresh', false],
    [TrainingPowerSystemsTrendChartComponent, 'refresh', false],
    [TrainingDurabilityTrajectoryChartComponent, 'refresh', true],
    [TrainingSwimPerformanceChartComponent, 'refresh', true],
    [ChartsFormComponent, 'refreshChart', false],
    [ChartsFreshnessForecastComponent, 'refreshChart', false],
    [ChartsSleepTrendComponent, 'refreshChart', false],
    [HealthMetricSeriesChartComponent, 'refresh', false],
  ] as const)('%s opts in explicitly, refreshes on note changes, and never fetches notes', async (Type, method, weekly) => {
    const chart = { isDisposed: () => false, on: vi.fn(), off: vi.fn(), dispatchAction: vi.fn(), getWidth: () => 320 };
    const loader = { init: vi.fn().mockResolvedValue(chart), setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
      subscribeToViewportResize: () => () => {}, attachMobileSeriesTapFeedback: () => () => {} };
    const component = new Type(loader as never, { error: vi.fn() } as never) as any;
    expect(component.timelineNotes).toBeNull();
    component.chartDiv = new ElementRef(document.createElement('div'));
    component.viewInitialized = true;
    const reportRange = vi.fn(); component.timelineNotes = { notes: [], select: vi.fn(), reportRange };
    component.model = { displayedPoints: [] };
    const axis = { xAxis: { type: 'time', min: Date.UTC(2026, 8, 1), max: Date.UTC(2026, 8, 7) }, series: [{ data: [] }] };
    // Rendering each adapter's lifecycle is separate from the existing domain option/formula tests.
    if (component.buildChartOption) vi.spyOn(component, 'buildChartOption').mockReturnValue({ option: axis });
    if (component.buildOption) vi.spyOn(component, 'buildOption').mockReturnValue(axis);
    if (Type === HealthMetricSeriesChartComponent) {
      component.model = { displayedPoints: [], series: { chartKind: 'line', metricId: 'body_weight' }, displayUnit: '', data: [], ariaLabel: '' };
      // Health's real option helper is tested in its own suite; just check change-driven lifecycle here.
      const refresh = vi.spyOn(component, method).mockResolvedValue(undefined);
      component.ngOnChanges({ timelineNotes: new SimpleChange(null, component.timelineNotes, false) });
      expect(refresh).toHaveBeenCalledOnce(); component.ngOnDestroy(); return;
    }
    await component[method]();
    expect(reportRange).toHaveBeenCalledWith(expect.anything(), { startDate: '2026-09-01', endDate: weekly ? '2026-09-13' : '2026-09-07' });
    const refresh = vi.spyOn(component, method).mockResolvedValue(undefined);
    component.ngOnChanges({ timelineNotes: new SimpleChange(null, component.timelineNotes, false) });
    expect(refresh).toHaveBeenCalledOnce(); component.ngOnDestroy();
  });
  it('opts in through explicit workspace inputs and keeps public/library defaults private-data-free', () => {
    const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
    const expectNoteBindings = (path: string, selectors: string[], expression: string) => {
      const template = document.createElement('template');
      template.innerHTML = source(path);
      for (const selector of selectors) {
        const elements = template.content.querySelectorAll(selector);
        expect(elements.length, `${path}: missing ${selector}`).toBeGreaterThan(0);
        for (const element of elements) {
          expect(element.getAttribute('[timelineNotes]'), `${path}: ${selector}`).toBe(expression);
        }
      }
    };
    // Check each consumer's opt-in, rather than the number of charts in a workspace.
    expectNoteBindings('src/app/components/health/health-workspace.component.html', [
      'app-dashboard-chart-library', 'app-health-priority-summary', 'app-sleep-trend-chart', 'app-health-metric-chart',
    ], 'timelineNotes.context()');
    expectNoteBindings('src/app/components/training/training-workspace.component.html', [
      'app-training-readiness-trend-chart', 'app-form-chart', 'app-freshness-forecast-chart',
      'app-training-power-systems-trend-chart', 'app-training-swim-performance-chart',
      'app-training-durability-trajectory-chart', 'app-training-body-weight-trend-chart',
    ], 'timelineNotes.context()');
    expect(source('src/app/components/health/health-priority-summary.component.html')).toContain('[timelineNotes]="timelineNotes()"');
    expectNoteBindings('src/app/components/tile/chart/tile.chart.component.html', [
      'app-dashboard-health-chart', 'app-form-chart', 'app-freshness-forecast-chart', 'app-sleep-trend-chart', 'app-hrv-chart',
    ], 'previewMode ? null : notesContext()');
    expectNoteBindings('src/app/components/tile/chart/tile.chart.component.html', [
      'app-activity-calendar-tile',
    ], 'previewMode ? null : timelineNotes()');
    expectNoteBindings('src/app/components/charts/health/dashboard-health-chart.component.html', [
      'app-health-metric-series-chart',
    ], 'thumbnail() || showingExample() ? null : timelineNotes()');
    expectNoteBindings('src/app/components/charts/health/dashboard-health-chart.component.html', [
      'app-sleep-trend-chart',
    ], 'showingExample() ? null : timelineNotes()');
    expect(source('src/app/components/summaries/summaries.component.html')).toContain('<app-timeline-notes-workspace [ownerUid]="user?.uid"');
    const cleanup = source('extensions/delete-user-data.env');
    expect(cleanup).toContain('FIRESTORE_DELETE_MODE=recursive'); expect(cleanup).toContain('FIRESTORE_PATHS=users/{UID}');
  });
});
