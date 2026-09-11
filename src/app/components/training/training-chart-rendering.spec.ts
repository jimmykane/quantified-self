import { ElementRef } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chartViewportQueue } from '../../helpers/chart-viewport-queue';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { TrainingBodyWeightTrendChartComponent } from './training-body-weight-trend-chart.component';
import { TrainingReadinessTrendChartComponent } from './training-readiness-trend-chart.component';
import { TrainingPowerSystemsTrendChartComponent } from './training-power-systems-trend-chart.component';
import { TrainingSwimPerformanceChartComponent } from './training-swim-performance-chart.component';
import { TrainingDurabilityTrajectoryChartComponent } from './training-durability-trajectory-chart.component';

const charts = [
  { label: 'body weight', component: TrainingBodyWeightTrendChartComponent },
  { label: 'readiness', component: TrainingReadinessTrendChartComponent },
  { label: 'power systems', component: TrainingPowerSystemsTrendChartComponent },
  { label: 'swimming', component: TrainingSwimPerformanceChartComponent },
  { label: 'durability', component: TrainingDurabilityTrajectoryChartComponent },
];

describe.each(charts)('Training $label chart rendering', ({ component: ChartComponent }) => {
  afterEach(() => vi.restoreAllMocks());

  function setup() {
    let reveal!: (visible: boolean) => void;
    const ready = new Promise<boolean>(resolve => { reveal = resolve; });
    const cancel = vi.fn(() => reveal(false));
    vi.spyOn(chartViewportQueue, 'wait').mockReturnValue({ ready, cancel });
    const chart = { isDisposed: vi.fn(() => false), dispatchAction: vi.fn() };
    const loader = {
      init: vi.fn().mockResolvedValue(chart),
      load: vi.fn().mockResolvedValue(undefined),
      setOption: vi.fn(),
      dispose: vi.fn(),
      resize: vi.fn(),
      subscribeToViewportResize: vi.fn(() => () => undefined),
      attachMobileSeriesTapFeedback: vi.fn(() => () => undefined),
    };
    const component = new ChartComponent(
      loader as unknown as EChartsLoaderService,
      { error: vi.fn() } as unknown as LoggerService,
    );
    const element = document.createElement('div');
    component.chartDiv = new ElementRef(element);
    return { component, element, loader, reveal, cancel };
  }

  it('waits until nearby before initializing and drawing the plot', async () => {
    const { component, element, loader, reveal } = setup();
    const pending = component.ngAfterViewInit();
    expect(chartViewportQueue.wait).toHaveBeenCalledWith(element, expect.any(Function));
    expect(loader.init).not.toHaveBeenCalled();
    expect(loader.setOption).not.toHaveBeenCalled();

    reveal(true);
    await pending;
    expect(loader.init).toHaveBeenCalledExactlyOnceWith(element, 'light', undefined);
    expect(loader.setOption).toHaveBeenCalledOnce();
    component.ngOnDestroy();
  });

  it('cancels a queued plot when its route or sport is left before scrolling to it', async () => {
    const { component, loader, cancel } = setup();
    const pending = component.ngAfterViewInit();
    component.ngOnDestroy();
    await pending;

    expect(cancel).toHaveBeenCalledOnce();
    expect(loader.init).not.toHaveBeenCalled();
    expect(loader.setOption).not.toHaveBeenCalled();
  });
});
