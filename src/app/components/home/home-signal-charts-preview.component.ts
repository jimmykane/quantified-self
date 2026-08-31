import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  inject,
} from '@angular/core';
import { AppThemes } from '@sports-alliance/sports-lib';
import { AppSignalChartsModule } from '../../modules/app-signal-charts.module';
import { AppThemeService } from '../../services/app.theme.service';
import {
  HOME_SIGNAL_CHARTS_PREVIEW_ANCHOR_MS,
  buildHomeSignalChartsPreviewData,
} from './home-signal-charts-preview-data.helper';

@Component({
  selector: 'app-home-signal-charts-preview',
  templateUrl: './home-signal-charts-preview.component.html',
  styleUrls: ['./home-signal-charts-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [AppSignalChartsModule],
})
export class HomeSignalChartsPreviewComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly themeService = inject(AppThemeService);
  private readonly previewData = buildHomeSignalChartsPreviewData(HOME_SIGNAL_CHARTS_PREVIEW_ANCHOR_MS);

  readonly darkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);
  readonly animationsEnabled = isPlatformBrowser(this.platformId)
    && (typeof window.matchMedia !== 'function'
      || !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  readonly freshnessForecast = this.previewData.freshnessForecast;
  readonly intensityDistribution = this.previewData.intensityDistribution;
  readonly intensityWeekContext = 'Example training week';
  readonly efficiencyTrend = this.previewData.efficiencyTrend;
  readonly powerCurve = this.previewData.powerCurve;
  readonly formTimeline = this.previewData.formTimeline;
  readonly latestFormPoint = this.previewData.latestFormPoint;
}
