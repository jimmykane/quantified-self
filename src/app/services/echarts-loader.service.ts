import { Inject, Injectable, NgZone, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { EChartsType } from 'echarts/core';
import { AppHapticsService } from './app.haptics.service';
import type {
  EChartsClickHapticFeedback,
  EChartsMobileTapFeedbackOptions
} from '../helpers/echarts-tooltip-interaction.helper';

type EChartsCoreModule = typeof import('echarts/core');
type EChartsOption = Parameters<EChartsType['setOption']>[0];

const CLICK_AXIS_POINTER_HAPTIC_SUPPRESSION_MS = 180;
const DEFAULT_SURFACE_DRAG_THRESHOLD_PX = 8;
const DEFAULT_SURFACE_DRAG_BUCKET_PX = 24;
const FALLBACK_INIT_SIZE_PX = 1;
type EChartsSetOptionSettings = Parameters<EChartsType['setOption']>[1];
type EChartsResizeOptions = NonNullable<Parameters<EChartsType['resize']>[0]>;
type EChartsInitOptions = Parameters<EChartsCoreModule['init']>[2];
type EChartsInitSizeOptions = {
  width?: number | string | null;
  height?: number | string | null;
};
type ZRenderLike = {
  on(eventName: string, handler: (params: unknown) => void): void;
  off(eventName: string, handler: (params: unknown) => void): void;
};
type EChartsWithZRender = EChartsType & {
  getZr?: () => ZRenderLike | null | undefined;
};
const SUPPRESSED_HAPTIC_EVENT_SOURCES = new Set([
  'event-chart-brush-zoom',
]);

export { ECHARTS_GLOBAL_FONT_FAMILY } from '../helpers/echarts-theme.helper';

@Injectable({
  providedIn: 'root'
})
export class EChartsLoaderService {
  private loader: Promise<EChartsCoreModule> | null = null;
  private cachedCore: EChartsCoreModule | null = null;
  private viewportResizeSubscribers = new Set<() => void>();
  private viewportListenersBound = false;
  private viewportResizeFrameId: number | null = null;

  private readonly handleViewportResize = () => {
    if (!this.viewportResizeSubscribers.size) {
      return;
    }

    if (typeof requestAnimationFrame === 'undefined') {
      this.notifyViewportResizeSubscribers();
      return;
    }

    if (this.viewportResizeFrameId !== null) {
      return;
    }

    this.viewportResizeFrameId = requestAnimationFrame(() => {
      this.viewportResizeFrameId = null;
      this.notifyViewportResizeSubscribers();
    });
  };

  constructor(
    private zone: NgZone,
    @Inject(PLATFORM_ID) private platformId: object,
    private hapticsService: AppHapticsService
  ) { }

  private ensureBrowser(): void {
    if (!isPlatformBrowser(this.platformId)) {
      throw new Error('ECharts can only be initialized in the browser.');
    }
  }

  public async load(): Promise<EChartsCoreModule> {
    this.ensureBrowser();

    if (this.cachedCore) {
      return this.cachedCore;
    }

    if (!this.loader) {
      this.loader = (async () => {
        const [core, charts, components, renderers] = await Promise.all([
          import('echarts/core'),
          import('echarts/charts'),
          import('echarts/components'),
          import('echarts/renderers')
        ]);

        core.use([
            charts.BarChart,
            charts.PictorialBarChart,
            charts.CustomChart,
            charts.PieChart,
            charts.LineChart,
            charts.ScatterChart,
          components.GraphicComponent,
          components.GridComponent,
          components.TooltipComponent,
          components.LegendComponent,
          components.TitleComponent,
          components.AxisPointerComponent,
          components.MarkLineComponent,
          components.VisualMapComponent,
          components.ToolboxComponent,
          components.DataZoomComponent,
          components.BrushComponent,
          renderers.CanvasRenderer
        ]);

        this.cachedCore = core;
        return core;
      })().catch((error) => {
        // Allow retry if the first lazy-load attempt fails.
        this.loader = null;
        throw error;
      });
    }

    return this.loader;
  }

  public async init(container: HTMLElement, theme?: string, options?: EChartsInitOptions): Promise<EChartsType> {
    const echarts = await this.load();
    const resolvedTheme = this.resolveThemeName(theme);
    const initOptions = this.buildSafeInitOptions(container, options);
    return this.zone.runOutsideAngular(() => echarts.init(container, resolvedTheme, initOptions));
  }

  public setOption(chart: EChartsType, option: EChartsOption, settings?: EChartsSetOptionSettings): void {
    this.zone.runOutsideAngular(() => {
      chart.setOption(option, settings);
    });
  }

  public resize(chart: EChartsType, options?: EChartsResizeOptions): void {
    this.zone.runOutsideAngular(() => {
      chart.resize(options);
    });
  }

  public dispose(chart: EChartsType | null | undefined): void {
    if (!chart || chart.isDisposed()) {
      return;
    }
    this.zone.runOutsideAngular(() => {
      chart.dispose();
    });
  }

  private buildSafeInitOptions(container: HTMLElement, options?: EChartsInitOptions): EChartsInitOptions {
    const initOptions: EChartsInitOptions & EChartsInitSizeOptions = {
      renderer: 'canvas',
      useDirtyRect: false,
      ...options,
    };

    const containerSize = this.getContainerSize(container);
    if (!this.hasExplicitInitDimension(initOptions.width) && containerSize.width <= 0) {
      initOptions.width = FALLBACK_INIT_SIZE_PX;
    }
    if (!this.hasExplicitInitDimension(initOptions.height) && containerSize.height <= 0) {
      initOptions.height = FALLBACK_INIT_SIZE_PX;
    }

    return initOptions;
  }

  private hasExplicitInitDimension(value: EChartsInitSizeOptions['width']): boolean {
    return value !== undefined && value !== null;
  }

  private getContainerSize(container: HTMLElement): { width: number; height: number } {
    const clientWidth = Number(container.clientWidth);
    const clientHeight = Number(container.clientHeight);
    const width = Number.isFinite(clientWidth) ? clientWidth : 0;
    const height = Number.isFinite(clientHeight) ? clientHeight : 0;

    if (width > 0 && height > 0) {
      return { width, height };
    }

    const rect = container.getBoundingClientRect();
    const rectWidth = Number.isFinite(rect.width) ? rect.width : 0;
    const rectHeight = Number.isFinite(rect.height) ? rect.height : 0;
    return {
      width: width > 0 ? width : rectWidth,
      height: height > 0 ? height : rectHeight,
    };
  }

  public subscribeToViewportResize(listener: () => void): () => void {
    if (!isPlatformBrowser(this.platformId)) {
      return () => { };
    }

    this.viewportResizeSubscribers.add(listener);
    this.bindViewportListeners();

    return () => {
      this.viewportResizeSubscribers.delete(listener);

      if (!this.viewportResizeSubscribers.size) {
        this.unbindViewportListeners();
      }
    };
  }

  public attachMobileSeriesTapFeedback(chart: EChartsType, options: EChartsMobileTapFeedbackOptions = {}): () => void {
    if (!isPlatformBrowser(this.platformId)) {
      return () => { };
    }

    const axisPointerFeedback = options.axisPointerFeedback || 'always';
    const clickFeedback = this.resolveClickFeedbackMode(options.clickFeedback);
    const surfaceClickFeedback = options.surfaceClickFeedback === true;
    const surfaceDragFeedback = options.surfaceDragFeedback === true;
    const surfaceDragThresholdPx = this.resolvePositiveNumber(
      options.surfaceDragThresholdPx,
      DEFAULT_SURFACE_DRAG_THRESHOLD_PX
    );
    const surfaceDragBucketPx = this.resolvePositiveNumber(
      options.surfaceDragBucketPx,
      DEFAULT_SURFACE_DRAG_BUCKET_PX
    );
    let axisPointerHapticsArmed = axisPointerFeedback === 'always';
    let clickHapticsArmed = clickFeedback === 'always';
    let suppressAxisPointerHapticUntilMs = 0;
    let suppressChartClickHapticUntilMs = 0;
    let suppressSurfaceClickHapticUntilMs = 0;
    let surfacePointerActive = false;
    let surfacePointerStart: { x: number; y: number } | null = null;
    let surfacePointerMoved = false;
    let lastSurfaceDragHapticKey: string | null = null;
    const armAxisPointerHaptics = (suppressClickEcho = false) => {
      if (axisPointerFeedback !== 'afterFirstInteraction') {
        return;
      }

      axisPointerHapticsArmed = true;
      if (suppressClickEcho) {
        suppressAxisPointerHapticUntilMs = Math.max(
          suppressAxisPointerHapticUntilMs,
          Date.now() + CLICK_AXIS_POINTER_HAPTIC_SUPPRESSION_MS
        );
      }
    };
    const armClickHaptics = () => {
      if (clickFeedback !== 'afterFirstInteraction') {
        return;
      }

      clickHapticsArmed = true;
    };
    const suppressAxisPointerEcho = () => {
      if (axisPointerFeedback !== 'afterFirstInteraction') {
        return;
      }
      suppressAxisPointerHapticUntilMs = Math.max(
        suppressAxisPointerHapticUntilMs,
        Date.now() + CLICK_AXIS_POINTER_HAPTIC_SUPPRESSION_MS
      );
    };
    const suppressAllClickEcho = () => {
      const suppressUntilMs = Date.now() + CLICK_AXIS_POINTER_HAPTIC_SUPPRESSION_MS;
      suppressChartClickHapticUntilMs = Math.max(
        suppressChartClickHapticUntilMs,
        suppressUntilMs
      );
      suppressSurfaceClickHapticUntilMs = Math.max(
        suppressSurfaceClickHapticUntilMs,
        suppressUntilMs
      );
    };
    const suppressSurfaceClickEcho = () => {
      suppressSurfaceClickHapticUntilMs = Math.max(
        suppressSurfaceClickHapticUntilMs,
        Date.now() + CLICK_AXIS_POINTER_HAPTIC_SUPPRESSION_MS
      );
    };
    const suppressChartClickEcho = () => {
      suppressChartClickHapticUntilMs = Math.max(
        suppressChartClickHapticUntilMs,
        Date.now() + CLICK_AXIS_POINTER_HAPTIC_SUPPRESSION_MS
      );
    };
    const triggerChartClickFeedback = () => {
      if (clickFeedback === 'off' || !clickHapticsArmed || Date.now() <= suppressChartClickHapticUntilMs) {
        return;
      }
      suppressSurfaceClickEcho();
      suppressAxisPointerEcho();
      this.hapticsService.selection();
    };
    const triggerSurfaceClickFeedback = () => {
      if (clickFeedback === 'off' || !clickHapticsArmed || Date.now() <= suppressSurfaceClickHapticUntilMs) {
        return;
      }
      suppressChartClickEcho();
      suppressAxisPointerEcho();
      this.hapticsService.selection();
    };

    const onChartClick = (params: unknown) => {
      if (!this.isHapticEligibleClickEvent(params)) {
        return;
      }
      triggerChartClickFeedback();
      armAxisPointerHaptics(true);
      armClickHaptics();
    };
    const onDataZoom = (params: unknown) => {
      if (!this.isHapticEligibleDataZoomEvent(params)) {
        return;
      }
      this.hapticsService.selection();
      armAxisPointerHaptics();
      armClickHaptics();
    };
    const onBrushEnd = (params: unknown) => {
      if (!this.isHapticEligibleBrushEndEvent(params)) {
        return;
      }
      this.hapticsService.selection();
      armAxisPointerHaptics();
      armClickHaptics();
    };
    let lastAxisPointerHapticKey: string | null = null;
    const onAxisPointerUpdate = (params: unknown) => {
      if (axisPointerFeedback === 'off' || !axisPointerHapticsArmed) {
        return;
      }

      const hapticKey = this.resolveAxisPointerHapticKey(params);
      if (!hapticKey || hapticKey === lastAxisPointerHapticKey) {
        return;
      }
      lastAxisPointerHapticKey = hapticKey;
      if (suppressAxisPointerHapticUntilMs > 0 && Date.now() <= suppressAxisPointerHapticUntilMs) {
        return;
      }
      suppressAxisPointerHapticUntilMs = 0;

      this.hapticsService.selection();
    };
    const onSurfacePointerDown = (params: unknown) => {
      surfacePointerActive = true;
      surfacePointerStart = this.resolveSurfacePointerPosition(params);
      surfacePointerMoved = false;
      lastSurfaceDragHapticKey = null;
    };
    const onSurfacePointerMove = (params: unknown) => {
      if (!surfaceDragFeedback || !surfacePointerActive || !surfacePointerStart) {
        return;
      }

      const currentPointer = this.resolveSurfacePointerPosition(params);
      if (!currentPointer) {
        return;
      }

      const distance = Math.hypot(
        currentPointer.x - surfacePointerStart.x,
        currentPointer.y - surfacePointerStart.y
      );
      if (distance < surfaceDragThresholdPx) {
        return;
      }

      surfacePointerMoved = true;
      const hapticKey = this.resolveSurfaceDragHapticKey(currentPointer, surfaceDragBucketPx);
      if (hapticKey === lastSurfaceDragHapticKey) {
        return;
      }

      lastSurfaceDragHapticKey = hapticKey;
      suppressAllClickEcho();
      this.hapticsService.selection();
      armAxisPointerHaptics();
      armClickHaptics();
    };
    const onSurfacePointerUp = () => {
      surfacePointerActive = false;
      surfacePointerStart = null;
      lastSurfaceDragHapticKey = null;
      if (surfacePointerMoved) {
        suppressAllClickEcho();
      }
    };
    const onSurfaceClick = () => {
      if (!surfaceClickFeedback || surfacePointerMoved) {
        surfacePointerMoved = false;
        return;
      }

      triggerSurfaceClickFeedback();
      armAxisPointerHaptics(true);
      armClickHaptics();
    };

    const zRender = surfaceClickFeedback || surfaceDragFeedback
      ? (chart as EChartsWithZRender).getZr?.()
      : null;

    this.zone.runOutsideAngular(() => {
      chart.on('click', onChartClick as never);
      chart.on('datazoom', onDataZoom as never);
      chart.on('brushEnd', onBrushEnd as never);
      chart.on('updateAxisPointer', onAxisPointerUpdate as never);
      zRender?.on('mousedown', onSurfacePointerDown);
      zRender?.on('mousemove', onSurfacePointerMove);
      zRender?.on('mouseup', onSurfacePointerUp);
      zRender?.on('globalout', onSurfacePointerUp);
      zRender?.on('click', onSurfaceClick);
    });

    return () => {
      this.zone.runOutsideAngular(() => {
        chart.off('click', onChartClick as never);
        chart.off('datazoom', onDataZoom as never);
        chart.off('brushEnd', onBrushEnd as never);
        chart.off('updateAxisPointer', onAxisPointerUpdate as never);
        zRender?.off('mousedown', onSurfacePointerDown);
        zRender?.off('mousemove', onSurfacePointerMove);
        zRender?.off('mouseup', onSurfacePointerUp);
        zRender?.off('globalout', onSurfacePointerUp);
        zRender?.off('click', onSurfaceClick);
      });
    };
  }

  private resolveThemeName(theme?: string): string | undefined {
    const normalizedTheme = `${theme || ''}`.trim().toLowerCase();
    if (!normalizedTheme || normalizedTheme === 'light' || normalizedTheme.endsWith('light')) {
      return undefined;
    }
    if (normalizedTheme === 'dark' || normalizedTheme.endsWith('dark')) {
      return 'dark';
    }

    return theme || undefined;
  }

  private notifyViewportResizeSubscribers(): void {
    const listeners = [...this.viewportResizeSubscribers];
    for (const listener of listeners) {
      listener();
    }
  }

  private bindViewportListeners(): void {
    if (this.viewportListenersBound || !isPlatformBrowser(this.platformId)) {
      return;
    }

    window.addEventListener('resize', this.handleViewportResize, { passive: true });
    window.addEventListener('orientationchange', this.handleViewportResize, { passive: true });
    window.visualViewport?.addEventListener('resize', this.handleViewportResize, { passive: true });
    this.viewportListenersBound = true;
  }

  private unbindViewportListeners(): void {
    if (!this.viewportListenersBound || !isPlatformBrowser(this.platformId)) {
      return;
    }

    if (this.viewportResizeFrameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.viewportResizeFrameId);
      this.viewportResizeFrameId = null;
    }

    window.removeEventListener('resize', this.handleViewportResize);
    window.removeEventListener('orientationchange', this.handleViewportResize);
    window.visualViewport?.removeEventListener('resize', this.handleViewportResize);
    this.viewportListenersBound = false;
  }

  private isHapticEligibleClickEvent(params: unknown): boolean {
    if (!params || typeof params !== 'object') {
      return false;
    }

    const clickParams = params as { componentType?: unknown };
    return clickParams.componentType === 'series'
      || clickParams.componentType === 'xAxis'
      || clickParams.componentType === 'yAxis';
  }

  private isHapticEligibleDataZoomEvent(params: unknown): boolean {
    return !this.isSuppressedHapticSource(params);
  }

  private isHapticEligibleBrushEndEvent(params: unknown): boolean {
    if (this.isSuppressedHapticSource(params)) {
      return false;
    }

    if (!params || typeof params !== 'object') {
      return true;
    }

    const brushParams = params as { areas?: unknown };
    if (!Array.isArray(brushParams.areas)) {
      return true;
    }

    return brushParams.areas.length > 0;
  }

  private resolveAxisPointerHapticKey(params: unknown): string | null {
    if (this.isSuppressedHapticSource(params) || !params || typeof params !== 'object') {
      return null;
    }

    const axisPointerParams = params as { axesInfo?: unknown };
    if (!Array.isArray(axisPointerParams.axesInfo)) {
      return null;
    }

    for (const axisInfo of axisPointerParams.axesInfo) {
      if (!axisInfo || typeof axisInfo !== 'object') {
        continue;
      }

      const info = axisInfo as {
        axisDim?: unknown;
        axisIndex?: unknown;
        value?: unknown;
      };
      if (info.axisDim !== 'x') {
        continue;
      }

      const value = this.normalizeAxisPointerValue(info.value);
      if (value === null) {
        continue;
      }

      const axisIndex = Number.isFinite(Number(info.axisIndex)) ? Number(info.axisIndex) : 0;
      return `x:${axisIndex}:${value}`;
    }

    return null;
  }

  private normalizeAxisPointerValue(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `${value}`;
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    return null;
  }

  private resolveSurfacePointerPosition(params: unknown): { x: number; y: number } | null {
    if (!params || typeof params !== 'object') {
      return null;
    }

    const eventParams = params as {
      offsetX?: unknown;
      offsetY?: unknown;
      event?: {
        offsetX?: unknown;
        offsetY?: unknown;
        zrX?: unknown;
        zrY?: unknown;
      };
    };
    const x = this.resolveFiniteNumber(eventParams.offsetX, eventParams.event?.offsetX, eventParams.event?.zrX);
    const y = this.resolveFiniteNumber(eventParams.offsetY, eventParams.event?.offsetY, eventParams.event?.zrY);
    if (x === null || y === null) {
      return null;
    }

    return { x, y };
  }

  private resolveSurfaceDragHapticKey(position: { x: number; y: number }, bucketPx: number): string {
    return `${Math.floor(position.x / bucketPx)}:${Math.floor(position.y / bucketPx)}`;
  }

  private resolveFiniteNumber(...values: unknown[]): number | null {
    for (const value of values) {
      const numberValue = Number(value);
      if (Number.isFinite(numberValue)) {
        return numberValue;
      }
    }

    return null;
  }

  private resolvePositiveNumber(value: unknown, fallback: number): number {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
  }

  private resolveClickFeedbackMode(value: EChartsClickHapticFeedback | undefined): 'always' | 'afterFirstInteraction' | 'off' {
    if (value === false || value === 'off') {
      return 'off';
    }

    if (value === 'afterFirstInteraction') {
      return 'afterFirstInteraction';
    }

    return 'always';
  }

  private isSuppressedHapticSource(params: unknown): boolean {
    if (!params || typeof params !== 'object') {
      return false;
    }

    const eventParams = params as { $from?: unknown };
    if (typeof eventParams.$from !== 'string') {
      return false;
    }

    const source = eventParams.$from.trim();
    if (!source) {
      return false;
    }

    return source.endsWith('-sync') || SUPPRESSED_HAPTIC_EVENT_SOURCES.has(source);
  }
}
