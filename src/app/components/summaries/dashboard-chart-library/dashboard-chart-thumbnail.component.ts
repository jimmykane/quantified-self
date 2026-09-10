import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, input, viewChild } from '@angular/core';
import type { DashboardChartPreview } from '../../../helpers/dashboard-chart-preview.helper';
import { buildDashboardChartThumbnailOption } from '../../../helpers/dashboard-chart-thumbnail.helper';
import { EChartsHostController } from '../../../helpers/echarts-host-controller';
import { resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

@Component({
  selector: 'app-dashboard-chart-thumbnail', standalone: true,
  templateUrl: './dashboard-chart-thumbnail.component.html', styleUrls: ['./dashboard-chart-thumbnail.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardChartThumbnailComponent {
  readonly preview = input.required<DashboardChartPreview>();
  readonly darkTheme = input(false);
  private readonly container = viewChild<ElementRef<HTMLElement>>('chartDiv');
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = new EChartsHostController({
    eChartsLoader: inject(EChartsLoaderService), logger: inject(LoggerService),
    logPrefix: '[DashboardChartThumbnail]', enableMobileTapFeedback: false,
  });
  private renderVersion = 0;

  constructor() {
    effect(() => {
      const container = this.container()?.nativeElement;
      const preview = this.preview();
      const darkTheme = this.darkTheme();
      if (container) void this.render(container, preview, darkTheme);
    });
    this.destroyRef.onDestroy(() => { this.renderVersion++; this.host.dispose(); });
  }

  private async render(container: HTMLElement, preview: DashboardChartPreview, darkTheme: boolean): Promise<void> {
    const version = ++this.renderVersion;
    const chart = await this.host.init(container, resolveEChartsThemeName(darkTheme));
    if (!chart || this.destroyRef.destroyed || version !== this.renderVersion) return;
    this.host.setOption(buildDashboardChartThumbnailOption(preview, darkTheme), { notMerge: true, lazyUpdate: false });
  }
}
