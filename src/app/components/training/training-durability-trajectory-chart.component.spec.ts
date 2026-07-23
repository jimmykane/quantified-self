import { ElementRef, NO_ERRORS_SCHEMA, SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { TrainingDurabilityTrajectoryViewModel } from '../../helpers/training-durability-view.helper';
import { getOrCreateEChartsTooltipHost } from '../../helpers/echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from '../../helpers/echarts-tooltip-position.helper';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { TrainingDurabilityTrajectoryChartComponent } from './training-durability-trajectory-chart.component';

function trajectory(): TrainingDurabilityTrajectoryViewModel {
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  return {
    contextKey: 'running|power|W|-|-',
    contextLabel: 'Running · Power',
    title: 'Running durability trend',
    metricLabel: 'Aerobic decoupling',
    metricDescription: 'Weekly median first-versus-second-half aerobic-efficiency drift.',
    eligibilityDescription: 'Only comparable steady power-and-heart-rate sessions produce a trend point.',
    sourceActivityLabel: 'Power recorded',
    barExplanation: 'Bar height shows power-recorded activities; labels show eligible / power-recorded.',
    activityCountSummary: 'Across 12 weeks: 36 candidates · 32 with power · 32 eligible',
    exclusionSummary: 'Primary exclusions: No recorded power 1 · Too variable 1',
    unitLabel: '%',
    noEligibleWeekCount: 1,
    unavailableMetricWeekCount: 1,
    points: Array.from({ length: 12 }, (_, index) => ({
      weekStartDayMs: Date.UTC(2026, 3, 20) + (index * weekMs),
      weekEndDayMs: Date.UTC(2026, 3, 26) + (index * weekMs),
      value: index === 1 || index === 2 ? null : 4 - (index * 0.1),
      candidateActivityCount: 3,
      sourceActivityCount: index === 1 ? 0 : index === 2 ? 2 : 3,
      eligibleSampleCount: index === 1 ? 0 : index === 2 ? 2 : 3,
      exclusionReasons: index === 1
        ? [{ reason: 'missing-output', label: 'No recorded power', activityCount: 1 }]
        : index === 2
          ? [{ reason: 'too-variable', label: 'Too variable', activityCount: 1 }]
          : [],
      hasEligibleSamples: index !== 1,
    })),
  };
}

function createComponent(): TrainingDurabilityTrajectoryChartComponent {
  return new TrainingDurabilityTrajectoryChartComponent(
    { init: vi.fn() } as any,
    { error: vi.fn() } as any,
  );
}

describe('TrainingDurabilityTrajectoryChartComponent', () => {
  it('initializes after Angular inserts the conditional chart host', async () => {
    const chart = {
      dispatchAction: vi.fn(),
      isDisposed: vi.fn(() => false),
    };
    const eChartsLoader = {
      attachMobileSeriesTapFeedback: vi.fn(() => () => undefined),
      dispose: vi.fn(),
      init: vi.fn().mockResolvedValue(chart),
      resize: vi.fn(),
      setOption: vi.fn(),
      subscribeToViewportResize: vi.fn(() => () => undefined),
    };
    await TestBed.configureTestingModule({
      declarations: [TrainingDurabilityTrajectoryChartComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: eChartsLoader },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    const fixture = TestBed.createComponent(TrainingDurabilityTrajectoryChartComponent);

    fixture.detectChanges();
    await fixture.whenStable();
    expect(eChartsLoader.init).not.toHaveBeenCalled();

    fixture.componentRef.setInput('trajectory', trajectory());
    fixture.componentRef.setInput('status', 'ready');
    fixture.detectChanges();
    await fixture.whenStable();

    const chartElement = fixture.nativeElement.querySelector('.durability-trajectory-chart');
    expect(chartElement).not.toBeNull();
    expect(eChartsLoader.init).toHaveBeenCalledTimes(1);
    expect(eChartsLoader.init).toHaveBeenCalledWith(chartElement, 'light', undefined);
    await vi.waitFor(() => expect(eChartsLoader.setOption).toHaveBeenCalledTimes(1));

    fixture.componentRef.setInput('trajectory', null);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(eChartsLoader.dispose).toHaveBeenCalledWith(chart);

    fixture.destroy();
  });

  it('plots a readable 12-week primary metric with power-data bars and explained ineligible weeks', () => {
    const component = createComponent();
    component.trajectory = trajectory();
    component.status = 'ready';
    component.chartDiv = new ElementRef(document.createElement('div'));
    const chartDiv = component.chartDiv;
    expect(chartDiv).not.toBeNull();
    Object.defineProperty(chartDiv?.nativeElement, 'clientWidth', { value: 900 });
    (component as any).refreshLabels();

    const option = (component as any).buildOption();
    expect(option.xAxis.data).toHaveLength(12);
    expect(option.yAxis).toHaveLength(2);
    expect(option.series.map((series: any) => series.name)).toEqual(['Power recorded', 'Aerobic decoupling']);
    expect(option.series[0].data[1]).toBe(0);
    expect(option.series[0].label.formatter({ dataIndex: 1 })).toBe('No power');
    expect(option.series[0].label.formatter({ dataIndex: 2 })).toBe('2/2');
    expect(option.series[1].data[1]).toBeNull();
    expect(option.series[1].connectNulls).toBe(false);
    expect(option.tooltip).toEqual(expect.objectContaining({
      appendTo: getOrCreateEChartsTooltipHost,
      confine: false,
      position: getViewportConstrainedTooltipPosition,
      triggerOn: 'mousemove|click',
    }));
    expect(component.availabilityText).toContain('11 of 12 weeks produced comparable evidence');
    expect(component.availabilityText).toContain('1 with eligible samples but no aerobic decoupling');

    const emptyTooltip = option.tooltip.formatter([{ dataIndex: 1 }]);
    expect(emptyTooltip).toContain('No comparable sample');
    expect(emptyTooltip).toContain('Power recorded');
    expect(emptyTooltip).toContain('0 workouts');
    expect(emptyTooltip).toContain('No recorded power');
  });

  it('keeps mobile tooltips tap-triggered and visible outside the horizontal chart scroller', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as typeof window.matchMedia;

    try {
      const component = createComponent();
      component.trajectory = trajectory();
      component.status = 'ready';
      component.chartDiv = new ElementRef(document.createElement('div'));

      const option = (component as any).buildOption();

      expect(option.tooltip).toEqual(expect.objectContaining({
        appendTo: getOrCreateEChartsTooltipHost,
        confine: false,
        position: getViewportConstrainedTooltipPosition,
        triggerOn: 'click',
      }));
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('surfaces pending status without replacing available trajectory data', async () => {
    const component = createComponent();
    component.trajectory = trajectory();
    component.status = 'building';
    component.ngOnChanges({
      trajectory: new SimpleChange(null, component.trajectory, true),
      status: new SimpleChange('missing', 'building', true),
    });
    await Promise.resolve();

    expect(component.isUpdating).toBe(true);
    expect(component.availabilityText).toContain('11 of 12 weeks');
  });
});
