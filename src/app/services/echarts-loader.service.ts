import { Inject, Injectable, NgZone, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { EChartsType } from 'echarts/core';

type EChartsCoreModule = typeof import('echarts/core');
type EChartsOption = Parameters<EChartsType['setOption']>[0];
type EChartsSetOptionSettings = Parameters<EChartsType['setOption']>[1];

@Injectable({
  providedIn: 'root'
})
export class EChartsLoaderService {
  private loader: Promise<EChartsCoreModule> | null = null;
  private cachedCore: EChartsCoreModule | null = null;

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
          components.GridComponent,
          components.TooltipComponent,
          components.LegendComponent,
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

  public async init(container: HTMLElement, theme?: string): Promise<EChartsType> {
    const echarts = await this.load();
    return this.zone.runOutsideAngular(() => echarts.init(container, theme));
  }

  public setOption(chart: EChartsType, option: EChartsOption, settings?: EChartsSetOptionSettings): void {
    this.zone.runOutsideAngular(() => {
      chart.setOption(option, settings);
    });
  }

  public resize(chart: EChartsType): void {
    this.zone.runOutsideAngular(() => {
      chart.resize();
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
}
