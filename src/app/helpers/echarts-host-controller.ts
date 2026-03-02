import type { EChartsType } from 'echarts/core';
import { EChartsLoaderService } from '../services/echarts-loader.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];
type ChartSetOptionSettings = Parameters<EChartsType['setOption']>[1];
type ChartMainType = 'series' | 'xAxis' | 'yAxis' | 'dataZoom';

function buildMergeUpdateSettings(replaceMerge: readonly ChartMainType[]): ChartSetOptionSettings {
  return {
    notMerge: false,
    lazyUpdate: true,
    replaceMerge: [...replaceMerge]
  };
}

export const ECHARTS_SERIES_MERGE_UPDATE_SETTINGS = buildMergeUpdateSettings(['series']);
export const ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS = buildMergeUpdateSettings(['series', 'xAxis', 'yAxis']);
export const ECHARTS_INTERACTIVE_CARTESIAN_MERGE_UPDATE_SETTINGS = buildMergeUpdateSettings([
  'series',
  'xAxis',
  'yAxis',
  'dataZoom'
]);

export interface EChartsHostControllerConfig {
  eChartsLoader: EChartsLoaderService;
  logger?: {
    error?: (...args: unknown[]) => void;
  };
  logPrefix?: string;
}

export class EChartsHostController {
  private chart: EChartsType | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeFrameId: number | null = null;
  private initPromise: Promise<EChartsType | null> | null = null;
  private observedContainer: HTMLElement | null = null;
  private viewportListenersBound = false;
  private readonly handleViewportResize = () => {
    this.scheduleResize();
  };

  constructor(private readonly config: EChartsHostControllerConfig) { }

  public async init(container: HTMLElement | null | undefined, theme?: string): Promise<EChartsType | null> {
    if (!container) {
      return null;
    }

    if (this.chart && !this.chart.isDisposed()) {
      if (this.observedContainer !== container) {
        this.observeContainer(container);
      }
      return this.chart;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        this.chart = await this.config.eChartsLoader.init(container, theme);
        this.observeContainer(container);
        this.observeViewport();
        return this.chart;
      } catch (error) {
        this.chart = null;
        this.config.logger?.error?.(
          `${this.config.logPrefix || '[EChartsHostController]'} Failed to initialize ECharts`,
          error
        );
        return null;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  public getChart(): EChartsType | null {
    return this.chart;
  }

  public setOption(option: ChartOption, settings?: ChartSetOptionSettings): boolean {
    if (!this.chart) {
      return false;
    }
    this.config.eChartsLoader.setOption(this.chart, option, settings);
    return true;
  }

  public scheduleResize(): void {
    if (!this.chart) {
      return;
    }

    if (typeof requestAnimationFrame === 'undefined') {
      this.config.eChartsLoader.resize(this.chart);
      return;
    }

    if (this.resizeFrameId !== null) {
      return;
    }

    this.resizeFrameId = requestAnimationFrame(() => {
      this.resizeFrameId = null;
      if (!this.chart) {
        return;
      }
      this.config.eChartsLoader.resize(this.chart);
    });
  }

  public dispose(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.observedContainer = null;
    this.teardownViewportListeners();

    if (this.resizeFrameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.resizeFrameId);
      this.resizeFrameId = null;
    }

    this.config.eChartsLoader.dispose(this.chart);
    this.chart = null;
  }

  private observeContainer(container: HTMLElement): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleResize();
    });
    this.resizeObserver.observe(container);

    this.observedContainer = container;
  }

  private observeViewport(): void {
    if (this.viewportListenersBound || typeof window === 'undefined') {
      return;
    }

    window.addEventListener('resize', this.handleViewportResize, { passive: true });
    window.addEventListener('orientationchange', this.handleViewportResize, { passive: true });
    window.visualViewport?.addEventListener('resize', this.handleViewportResize, { passive: true });
    this.viewportListenersBound = true;
  }

  private teardownViewportListeners(): void {
    if (!this.viewportListenersBound || typeof window === 'undefined') {
      return;
    }

    window.removeEventListener('resize', this.handleViewportResize);
    window.removeEventListener('orientationchange', this.handleViewportResize);
    window.visualViewport?.removeEventListener('resize', this.handleViewportResize);
    this.viewportListenersBound = false;
  }
}
