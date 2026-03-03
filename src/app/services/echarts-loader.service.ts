import { Inject, Injectable, NgZone, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { EChartsType } from 'echarts/core';

type EChartsCoreModule = typeof import('echarts/core');
type EChartsOption = Parameters<EChartsType['setOption']>[0];
type EChartsSetOptionSettings = Parameters<EChartsType['setOption']>[1];
type EChartsThemeDefinition = Record<string, unknown>;
type EChartsResizeOptions = NonNullable<Parameters<EChartsType['resize']>[0]>;
type EChartsInitOptions = Parameters<EChartsCoreModule['init']>[2];

export const ECHARTS_GLOBAL_FONT_FAMILY = "'Barlow Condensed', sans-serif";
const ECHARTS_LIGHT_THEME_NAME = 'quantified-self-light';
const ECHARTS_DARK_THEME_NAME = 'quantified-self-dark';

function buildEChartsFontTheme(darkMode: boolean): EChartsThemeDefinition {
  const textStyle = { fontFamily: ECHARTS_GLOBAL_FONT_FAMILY };

  return {
    darkMode,
    textStyle,
    title: {
      textStyle,
      subtextStyle: textStyle
    },
    legend: {
      textStyle
    },
    tooltip: {
      textStyle
    },
    axisPointer: {
      label: textStyle
    },
    categoryAxis: {
      axisLabel: textStyle,
      nameTextStyle: textStyle
    },
    valueAxis: {
      axisLabel: textStyle,
      nameTextStyle: textStyle
    },
    timeAxis: {
      axisLabel: textStyle,
      nameTextStyle: textStyle
    },
    logAxis: {
      axisLabel: textStyle,
      nameTextStyle: textStyle
    }
  };
}

@Injectable({
  providedIn: 'root'
})
export class EChartsLoaderService {
  private loader: Promise<EChartsCoreModule> | null = null;
  private cachedCore: EChartsCoreModule | null = null;
  private themesRegistered = false;
  private groupRefCounts = new Map<string, number>();
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

  constructor(private zone: NgZone, @Inject(PLATFORM_ID) private platformId: object) { }

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
          components.DataZoomComponent,
          components.BrushComponent,
          renderers.CanvasRenderer
        ]);

        this.registerThemes(core);
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
    return this.zone.runOutsideAngular(() => echarts.init(container, resolvedTheme, {
      renderer: 'canvas',
      useDirtyRect: false,
      ...options,
    }));
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

  public async connectGroup(groupId: string): Promise<void> {
    const normalizedGroupID = `${groupId || ''}`.trim();
    if (!normalizedGroupID) {
      return;
    }

    const currentRefCount = this.groupRefCounts.get(normalizedGroupID) ?? 0;
    this.groupRefCounts.set(normalizedGroupID, currentRefCount + 1);
    if (currentRefCount > 0) {
      return;
    }

    try {
      const echarts = await this.load();
      this.zone.runOutsideAngular(() => {
        echarts.connect(normalizedGroupID);
      });
    } catch (error) {
      this.groupRefCounts.delete(normalizedGroupID);
      throw error;
    }
  }

  public async disconnectGroup(groupId: string): Promise<void> {
    const normalizedGroupID = `${groupId || ''}`.trim();
    if (!normalizedGroupID) {
      return;
    }

    const currentRefCount = this.groupRefCounts.get(normalizedGroupID);
    if (!currentRefCount) {
      return;
    }

    if (currentRefCount > 1) {
      this.groupRefCounts.set(normalizedGroupID, currentRefCount - 1);
      return;
    }

    const echarts = await this.load();
    const latestRefCount = this.groupRefCounts.get(normalizedGroupID);
    if (!latestRefCount) {
      return;
    }

    if (latestRefCount > 1) {
      this.groupRefCounts.set(normalizedGroupID, latestRefCount - 1);
      return;
    }

    this.groupRefCounts.delete(normalizedGroupID);
    this.zone.runOutsideAngular(() => {
      echarts.disconnect(normalizedGroupID);
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

  private registerThemes(core: EChartsCoreModule): void {
    if (this.themesRegistered) {
      return;
    }

    core.registerTheme(ECHARTS_LIGHT_THEME_NAME, buildEChartsFontTheme(false));
    core.registerTheme(ECHARTS_DARK_THEME_NAME, buildEChartsFontTheme(true));
    this.themesRegistered = true;
  }

  private resolveThemeName(theme?: string): string {
    const normalizedTheme = `${theme || ''}`.trim().toLowerCase();
    if (!normalizedTheme || normalizedTheme === 'light' || normalizedTheme.endsWith('light')) {
      return ECHARTS_LIGHT_THEME_NAME;
    }
    if (normalizedTheme === 'dark' || normalizedTheme.endsWith('dark')) {
      return ECHARTS_DARK_THEME_NAME;
    }

    return theme || ECHARTS_LIGHT_THEME_NAME;
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
}
