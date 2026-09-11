import type { EChartsType } from 'echarts/core';
import { TimelineNotesChartBinding, type TimelineNoteChartContext, type TimelineNoteAxisHints } from './timeline-notes-chart.helper';
import { EChartsLoaderService } from '../services/echarts-loader.service';
import type { EChartsMobileTapFeedbackOptions } from './echarts-tooltip-interaction.helper';
import { chartViewportQueue } from './chart-viewport-queue';

type ChartOption = Parameters<EChartsType['setOption']>[0];
type ChartSetOptionSettings = Parameters<EChartsType['setOption']>[1];
type ChartActionPayload = Parameters<EChartsType['dispatchAction']>[0];
type ChartInitSettings = NonNullable<Parameters<EChartsLoaderService['init']>[2]>;
type ChartMainType = 'series' | 'xAxis' | 'yAxis' | 'dataZoom';
type MobileTapFeedbackOptionsResolver =
  | EChartsMobileTapFeedbackOptions
  | (() => EChartsMobileTapFeedbackOptions | null | undefined);

function buildMergeUpdateSettings(
  replaceMerge: readonly ChartMainType[],
  lazyUpdate = true
): ChartSetOptionSettings {
  return {
    notMerge: false,
    lazyUpdate,
    replaceMerge: [...replaceMerge]
  };
}

export const ECHARTS_SERIES_MERGE_UPDATE_SETTINGS = buildMergeUpdateSettings(['series']);
export const ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS = buildMergeUpdateSettings(['series', 'xAxis', 'yAxis']);
export const ECHARTS_SERIES_IMMEDIATE_UPDATE_SETTINGS = buildMergeUpdateSettings(['series'], false);
export const ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS = buildMergeUpdateSettings(['series', 'xAxis', 'yAxis'], false);
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
  enableMobileTapFeedback?: boolean;
  mobileTapFeedbackOptions?: MobileTapFeedbackOptionsResolver;
  deferUntilNearViewport?: boolean;
  /** Update size-dependent chart options after a real container resize. */
  onContainerResize?: (size: { width: number; height: number }) => void;
}

export class EChartsHostController {
  private readonly timelineNotes = new TimelineNotesChartBinding();
  public setTimelineNotes(context: TimelineNoteChartContext | null, hints: TimelineNoteAxisHints = {}): void {
    this.timelineNotes.set(context, hints);
  }
  private chart: EChartsType | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeFrameId: number | null = null;
  private initPromise: Promise<EChartsType | null> | null = null;
  private observedContainer: HTMLElement | null = null;
  private unsubscribeViewportResize: (() => void) | null = null;
  private unsubscribeTapFeedback: (() => void) | null = null;
  private currentTheme: string | undefined;
  private lifecycleVersion = 0;
  private lastResizeSize: { width: number; height: number; pixelRatio: number } | null = null;
  private cancelViewportWait: (() => void) | null = null;
  private initRequestID = 0;
  private pendingContainer: HTMLElement | null = null;
  private pendingTheme: string | undefined;

  constructor(private readonly config: EChartsHostControllerConfig) { }

  public async init(container: HTMLElement | null | undefined, theme?: string): Promise<EChartsType | null> {
    if (!container) {
      return null;
    }

    const requestID = ++this.initRequestID;

    const requestedTheme = theme || undefined;

    if (this.chart && !this.chart.isDisposed()) {
      if (this.observedContainer === container && this.currentTheme === requestedTheme) {
        return this.chart;
      }

      this.dispose();
    }

    // A removed off-screen host will never intersect. Cancel that wait rather
    // than making its replacement (or a new theme) depend on the old container.
    if (this.initPromise && this.cancelViewportWait
      && (this.pendingContainer !== container || this.pendingTheme !== requestedTheme)) {
      this.dispose();
    }

    if (this.initPromise) {
      const lifecycleVersion = this.lifecycleVersion;
      const pendingInitialization = this.initPromise;
      await pendingInitialization;
      if (this.config.deferUntilNearViewport && requestID !== this.initRequestID) return null;
      if (this.initPromise === pendingInitialization) {
        this.initPromise = null;
      }
      if (lifecycleVersion !== this.lifecycleVersion) {
        return null;
      }
      return this.init(container, requestedTheme);
    }

    const lifecycleVersion = this.lifecycleVersion;
    this.pendingContainer = container;
    this.pendingTheme = requestedTheme;
    const initialization = (async () => {
      try {
        if (this.config.deferUntilNearViewport) {
          const gate = chartViewportQueue.wait(container, () => this.config.eChartsLoader.load());
          this.cancelViewportWait = gate.cancel;
          const ready = await gate.ready;
          if (this.cancelViewportWait === gate.cancel) this.cancelViewportWait = null;
          if (!ready || lifecycleVersion !== this.lifecycleVersion) return null;
        }
        const chart = await this.config.eChartsLoader.init(container, requestedTheme, this.config.initOptions);
        if (!chart) {
          return null;
        }
        if (lifecycleVersion !== this.lifecycleVersion) {
          this.config.eChartsLoader.dispose(chart);
          return null;
        }

        this.chart = chart;
        this.currentTheme = requestedTheme;
        this.observeContainer(container);
        this.subscribeToViewportResize();
        this.subscribeToTapFeedback();
        return this.chart;
      } catch (error) {
        this.chart = null;
        this.currentTheme = undefined;
        this.config.logger?.error?.(
          `${this.config.logPrefix || '[EChartsHostController]'} Failed to initialize ECharts`,
          error
        );
        return null;
      }
    })();
    this.initPromise = initialization;
    try {
      const chart = await initialization;
      // Only the newest waiting refresh may apply its captured data after scrolling into view.
      return this.config.deferUntilNearViewport && requestID !== this.initRequestID ? null : chart;
    } finally {
      if (this.initPromise === initialization) {
        this.initPromise = null;
        this.pendingContainer = null;
        this.pendingTheme = undefined;
      }
    }
  }

  public getChart(): EChartsType | null {
    return this.chart;
  }

  public setOption(option: ChartOption, settings?: ChartSetOptionSettings): boolean {
    if (!this.chart) {
      return false;
    }
    this.config.eChartsLoader.setOption(this.chart, this.timelineNotes.apply(this.chart, option, this.currentTheme === 'dark'), settings);
    return true;
  }

  public hideTooltip(): boolean {
    return this.dispatchAction({ type: 'hideTip' });
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
    this.timelineNotes.dispose();
    this.lifecycleVersion += 1;
    this.cancelViewportWait?.();
    this.cancelViewportWait = null;

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.observedContainer = null;
    this.lastResizeSize = null;
    this.unsubscribeViewportResize?.();
    this.unsubscribeViewportResize = null;
    this.unsubscribeTapFeedback?.();
    this.unsubscribeTapFeedback = null;

    if (this.resizeFrameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.resizeFrameId);
      this.resizeFrameId = null;
    }

    this.config.eChartsLoader.dispose(this.chart);
    this.chart = null;
    this.currentTheme = undefined;
  }

  private observeContainer(container: HTMLElement): void {
    // Retain the host even when only the shared viewport-resize fallback is available.
    this.observedContainer = container;
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
  }

  private resizeToContainer(): void {
    if (!this.chart || !this.observedContainer) {
      return;
    }

    const { width, height } = this.getContainerSize(this.observedContainer);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      this.lastResizeSize = null;
      return;
    }

    const pixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    if (this.lastResizeSize?.width === width && this.lastResizeSize.height === height
      && this.lastResizeSize.pixelRatio === pixelRatio) return;

    this.config.eChartsLoader.resize(this.chart, {
      // ECharts retains explicit initialization dimensions unless resize replaces them.
      // Switch back to the live host size once layout is available (including overlays).
      width: 'auto',
      height: 'auto',
      silent: true,
    });
    this.lastResizeSize = { width, height, pixelRatio };
    this.config.onContainerResize?.({ width, height });
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

  private subscribeToTapFeedback(): void {
    if (!this.chart || this.unsubscribeTapFeedback || this.config.enableMobileTapFeedback === false) {
      return;
    }

    this.unsubscribeTapFeedback = this.config.eChartsLoader.attachMobileSeriesTapFeedback(
      this.chart,
      this.resolveMobileTapFeedbackOptions()
    );
  }

  private resolveMobileTapFeedbackOptions(): EChartsMobileTapFeedbackOptions | undefined {
    const options = this.config.mobileTapFeedbackOptions;
    const resolvedOptions = typeof options === 'function' ? options() : options;
    return resolvedOptions || undefined;
  }

  private dispatchAction(payload: ChartActionPayload): boolean {
    if (!this.chart || this.chart.isDisposed()) {
      return false;
    }

    this.chart.dispatchAction(payload);
    return true;
  }
}
