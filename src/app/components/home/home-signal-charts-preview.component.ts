import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  inject,
  input,
} from '@angular/core';
import { AppThemes } from '@sports-alliance/sports-lib';
import { MatCardModule } from '@angular/material/card';
import { AppSignalChartsModule } from '../../modules/app-signal-charts.module';
import { DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS } from '../../helpers/echarts-tooltip-interaction.helper';
import { AppThemeService } from '../../services/app.theme.service';
import {
  HOME_SIGNAL_CHARTS_PREVIEW_ANCHOR_MS,
  buildHomeSignalChartsPreviewData,
  buildHomeHeroSummaryMetrics,
} from './home-signal-charts-preview-data.helper';

@Component({
  selector: 'app-home-signal-charts-preview',
  templateUrl: './home-signal-charts-preview.component.html',
  styleUrls: ['./home-signal-charts-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [AppSignalChartsModule, MatCardModule],
})
export class HomeSignalChartsPreviewComponent {
  readonly hero = input(false);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly themeService = inject(AppThemeService);
  private readonly previewData = buildHomeSignalChartsPreviewData(HOME_SIGNAL_CHARTS_PREVIEW_ANCHOR_MS);

  readonly darkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);
  readonly animationsEnabled = isPlatformBrowser(this.platformId)
    && (typeof window.matchMedia !== 'function'
      || !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  readonly mobileTapFeedbackOptions = DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS;
  // This hero is viewport-deferred on the client. Keep its synthetic history current:
  // the production Form chart correctly decays old observations through today's date.
  readonly heroPreviewData = computed(() => this.hero()
    ? buildHomeSignalChartsPreviewData(Date.now())
    : this.previewData);
  readonly heroSummaryMetrics = buildHomeHeroSummaryMetrics();
  readonly freshnessForecast = this.previewData.freshnessForecast;
  readonly intensityDistribution = this.previewData.intensityDistribution;
  readonly intensityWeekContext = 'Example training week';
  readonly efficiencyTrend = this.previewData.efficiencyTrend;
  readonly powerCurve = this.previewData.powerCurve;
  readonly formTimeline = this.previewData.formTimeline;
  readonly latestFormPoint = this.previewData.latestFormPoint;
}
