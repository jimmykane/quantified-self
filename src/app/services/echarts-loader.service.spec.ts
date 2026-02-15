import { TestBed } from '@angular/core/testing';
import { NgZone, PLATFORM_ID } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { EChartsLoaderService } from './echarts-loader.service';

const echartsCoreMock = vi.hoisted(() => ({
  use: vi.fn(),
  init: vi.fn(),
}));

const echartsModulesMock = vi.hoisted(() => ({
  barChart: { chart: 'bar' },
  pieChart: { chart: 'pie' },
  lineChart: { chart: 'line' },
  graphicComponent: { component: 'graphic' },
  gridComponent: { component: 'grid' },
  tooltipComponent: { component: 'tooltip' },
  legendComponent: { component: 'legend' },
  titleComponent: { component: 'title' },
  axisPointerComponent: { component: 'axisPointer' },
  canvasRenderer: { renderer: 'canvas' },
}));

vi.mock('echarts/core', () => ({
  use: echartsCoreMock.use,
  init: echartsCoreMock.init,
}));

vi.mock('echarts/charts', () => ({
  BarChart: echartsModulesMock.barChart,
  PieChart: echartsModulesMock.pieChart,
  LineChart: echartsModulesMock.lineChart,
}));

vi.mock('echarts/components', () => ({
  GridComponent: echartsModulesMock.gridComponent,
  GraphicComponent: echartsModulesMock.graphicComponent,
  TooltipComponent: echartsModulesMock.tooltipComponent,
  LegendComponent: echartsModulesMock.legendComponent,
  TitleComponent: echartsModulesMock.titleComponent,
  AxisPointerComponent: echartsModulesMock.axisPointerComponent,
}));

vi.mock('echarts/renderers', () => ({
  CanvasRenderer: echartsModulesMock.canvasRenderer,
}));

describe('EChartsLoaderService', () => {
  let service: EChartsLoaderService;
  let zone: NgZone;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        EChartsLoaderService,
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });

    service = TestBed.inject(EChartsLoaderService);
    zone = TestBed.inject(NgZone);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should load ECharts modules once and cache the core module', async () => {
    const firstLoad = await service.load();
    const secondLoad = await service.load();

    expect(firstLoad).toBe(secondLoad);
    expect(echartsCoreMock.use).toHaveBeenCalledTimes(1);
    expect(echartsCoreMock.use).toHaveBeenCalledWith([
      echartsModulesMock.barChart,
      echartsModulesMock.pieChart,
      echartsModulesMock.lineChart,
      echartsModulesMock.graphicComponent,
      echartsModulesMock.gridComponent,
      echartsModulesMock.tooltipComponent,
      echartsModulesMock.legendComponent,
      echartsModulesMock.titleComponent,
      echartsModulesMock.axisPointerComponent,
      echartsModulesMock.canvasRenderer,
    ]);
  });

  it('should deduplicate concurrent load calls', async () => {
    const [coreA, coreB, coreC] = await Promise.all([
      service.load(),
      service.load(),
      service.load(),
    ]);

    expect(coreA).toBe(coreB);
    expect(coreB).toBe(coreC);
    expect(echartsCoreMock.use).toHaveBeenCalledTimes(1);
  });

  it('should recover from a failed initial load and allow retry', async () => {
    echartsCoreMock.use.mockImplementationOnce(() => {
      throw new Error('load failed');
    });

    await expect(service.load()).rejects.toThrow('load failed');
    expect(echartsCoreMock.use).toHaveBeenCalledTimes(1);

    const retriedCore = await service.load();

    expect(retriedCore).toBeDefined();
    expect(echartsCoreMock.use).toHaveBeenCalledTimes(2);
  });

  it('should initialize chart instance with theme', async () => {
    const chart = { id: 'chart-1' };
    const container = document.createElement('div');
    const runOutsideAngularSpy = vi.spyOn(zone, 'runOutsideAngular');
    echartsCoreMock.init.mockReturnValue(chart);

    const initialized = await service.init(container, 'dark');

    expect(runOutsideAngularSpy).toHaveBeenCalled();
    expect(echartsCoreMock.init).toHaveBeenCalledWith(container, 'dark');
    expect(initialized).toBe(chart);
  });

  it('should delegate setOption in runOutsideAngular', () => {
    const runOutsideAngularSpy = vi.spyOn(zone, 'runOutsideAngular');
    const chart = {
      setOption: vi.fn(),
    } as any;

    service.setOption(chart, { series: [] }, { notMerge: true });

    expect(runOutsideAngularSpy).toHaveBeenCalled();
    expect(chart.setOption).toHaveBeenCalledWith({ series: [] }, { notMerge: true });
  });

  it('should delegate resize in runOutsideAngular', () => {
    const runOutsideAngularSpy = vi.spyOn(zone, 'runOutsideAngular');
    const chart = {
      resize: vi.fn(),
    } as any;

    service.resize(chart);

    expect(runOutsideAngularSpy).toHaveBeenCalled();
    expect(chart.resize).toHaveBeenCalledTimes(1);
  });

  it('should dispose active charts and skip already-disposed charts', () => {
    const runOutsideAngularSpy = vi.spyOn(zone, 'runOutsideAngular');

    const activeChart = {
      isDisposed: vi.fn().mockReturnValue(false),
      dispose: vi.fn(),
    } as any;

    const disposedChart = {
      isDisposed: vi.fn().mockReturnValue(true),
      dispose: vi.fn(),
    } as any;

    service.dispose(activeChart);
    service.dispose(disposedChart);
    service.dispose(null);

    expect(runOutsideAngularSpy).toHaveBeenCalled();
    expect(activeChart.dispose).toHaveBeenCalledTimes(1);
    expect(disposedChart.dispose).not.toHaveBeenCalled();
  });

  it('should throw when loading in non-browser platform', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        EChartsLoaderService,
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    });

    const serverService = TestBed.inject(EChartsLoaderService);

    await expect(serverService.load()).rejects.toThrow('ECharts can only be initialized in the browser.');
  });
});
