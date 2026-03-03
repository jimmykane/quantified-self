import type { EChartsType } from 'echarts/core';
import { EChartsLoaderService } from '../services/echarts-loader.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];
type ChartSetOptionSettings = Parameters<EChartsType['setOption']>[1];
type ChartInitSettings = NonNullable<Parameters<EChartsLoaderService['init']>[2]>;
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
  initOptions?: ChartInitSettings;
}

export class EChartsHostController {
  private chart: EChartsType | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeFrameId: number | null = null;
  private initPromise: Promise<EChartsType | null> | null = null;
  private observedContainer: HTMLElement | null = null;
  private unsubscribeViewportResize: (() => void) | null = null;

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
        this.chart = await this.config.eChartsLoader.init(container, theme, this.config.initOptions);
        this.observeContainer(container);
        this.subscribeToViewportResize();
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
    if (!this.chart || !this.observedContainer) {
      return;
    }

    if (typeof requestAnimationFrame === 'undefined') {
      this.resizeToContainer();
      return;
    }

    if (this.resizeFrameId !== null) {
      return;
    }

    this.resizeFrameId = requestAnimationFrame(() => {
      this.resizeFrameId = null;
      if (!this.chart || !this.observedContainer) {
        return;
      }
      this.resizeToContainer();
    });
  }

  public dispose(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.observedContainer = null;
    this.unsubscribeViewportResize?.();
    this.unsubscribeViewportResize = null;

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

  private resizeToContainer(): void {
    if (!this.chart || !this.observedContainer) {
      return;
    }

    const { width, height } = this.getContainerSize(this.observedContainer);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return;
    }

    this.config.eChartsLoader.resize(this.chart, {
      silent: true,
    });
  }

  private getContainerSize(container: HTMLElement): { width: number; height: number } {
    const clientWidth = Number(container.clientWidth);
    const clientHeight = Number(container.clientHeight);

    if (Number.isFinite(clientWidth) && Number.isFinite(clientHeight) && clientWidth > 0 && clientHeight > 0) {
      return {
        width: clientWidth,
        height: clientHeight,
      };
    }

    const rect = container.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
    };
  }

  private subscribeToViewportResize(): void {
    if (this.unsubscribeViewportResize) {
      return;
    }

    this.unsubscribeViewportResize = this.config.eChartsLoader.subscribeToViewportResize(() => {
      this.scheduleResize();
    });
  }
}
