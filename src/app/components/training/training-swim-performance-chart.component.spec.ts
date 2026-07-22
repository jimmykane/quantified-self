import { ElementRef, SimpleChange } from '@angular/core';
import { SwimPaceUnits } from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import type { DashboardTrainingSwimPerformanceContext } from '../../helpers/dashboard-derived-metrics.helper';
import { getOrCreateEChartsTooltipHost } from '../../helpers/echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from '../../helpers/echarts-tooltip-position.helper';
import { TrainingSwimPerformanceChartComponent } from './training-swim-performance-chart.component';

function performance(pace: number | null = 100): DashboardTrainingSwimPerformanceContext {
  return {
    asOfDayMs: Date.UTC(2026, 6, 13),
    swolfContext: { stroke: 'freestyle', poolLengthMeters: 25 },
    weeks: [
      {
        weekStartMs: Date.UTC(2026, 6, 6), environment: 'pool', activityCount: 1,
        distanceMeters: 1_500, averagePaceSecondsPer100m: pace,
        paceActivityCount: pace === null ? 0 : 1, swolf: 42, swolfLengthCount: 60,
      },
      {
        weekStartMs: Date.UTC(2026, 6, 6), environment: 'open-water', activityCount: 1,
        distanceMeters: 2_000, averagePaceSecondsPer100m: pace === null ? null : pace + 10,
        paceActivityCount: pace === null ? 0 : 1, swolf: null, swolfLengthCount: 0,
      },
    ],
  };
}

function createComponent(): TrainingSwimPerformanceChartComponent {
  return new TrainingSwimPerformanceChartComponent(
    { init: vi.fn() } as any,
    { error: vi.fn() } as any,
  );
}

async function refresh(component: TrainingSwimPerformanceChartComponent): Promise<void> {
  component.ngOnChanges({
    performance: new SimpleChange(null, component.performance, true),
  });
  await Promise.resolve();
}

describe('TrainingSwimPerformanceChartComponent', () => {
  it('builds separate pool and open-water lines on an inverted pace axis', async () => {
    const component = createComponent();
    component.performance = performance();
    component.status = 'ready';
    component.unitSettings = { swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] } as any;
    component.chartDiv = new ElementRef(document.createElement('div'));
    Object.defineProperty(component.chartDiv.nativeElement, 'clientWidth', { value: 900 });

    await refresh(component);
    const option = (component as any).buildOption();

    expect(component.showEmpty).toBe(false);
    expect(component.view.paceUnit).toBe('/100yd');
    expect(option.yAxis.inverse).toBe(true);
    expect(option.series.map((series: any) => series.name)).toEqual(['Pool', 'Open water']);
    expect(option.series[1].lineStyle.type).toBe('dashed');
    expect(option.tooltip).toEqual(expect.objectContaining({
      appendTo: getOrCreateEChartsTooltipHost,
      confine: false,
      position: getViewportConstrainedTooltipPosition,
      triggerOn: 'mousemove|click',
    }));
    expect(component.view.latestSwolfText).toBe('42');
  });

  it('distinguishes loading, failed, no-session, and no-explicit-pace states', async () => {
    const component = createComponent();

    component.status = 'building';
    await refresh(component);
    expect(component.emptyTitle).toBe('Swimming pace is updating');
    expect(component.isUpdating).toBe(true);

    component.performance = performance();
    await refresh(component);
    expect(component.showEmpty).toBe(false);
    expect(component.isUpdating).toBe(true);

    component.status = 'failed';
    await refresh(component);
    expect(component.emptyTitle).toBe('Swimming pace is unavailable');
    expect(component.showEmpty).toBe(true);

    component.status = 'ready';
    component.performance = null;
    await refresh(component);
    expect(component.emptyTitle).toBe('No swimming workouts yet');

    component.performance = performance(null);
    await refresh(component);
    expect(component.emptyTitle).toBe('No explicit swim pace yet');
    expect(component.emptyHint).toContain('rests are not used');
  });
});
