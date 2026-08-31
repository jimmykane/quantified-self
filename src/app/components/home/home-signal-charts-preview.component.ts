import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  inject,
} from '@angular/core';
import { AppThemes } from '@sports-alliance/sports-lib';
import { AppChartsModule } from '../../modules/app-charts.module';
import { AppThemeService } from '../../services/app.theme.service';
import { buildHomeSignalChartsPreviewData } from './home-signal-charts-preview-data.helper';

@Component({
  selector: 'app-home-signal-charts-preview',
  templateUrl: './home-signal-charts-preview.component.html',
  styleUrls: ['./home-signal-charts-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [AppChartsModule],
})
export class HomeSignalChartsPreviewComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly themeService = inject(AppThemeService);
  private readonly previewData = buildHomeSignalChartsPreviewData(Date.now());

  readonly darkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);
  readonly animationsEnabled = isPlatformBrowser(this.platformId)
    && (typeof window.matchMedia !== 'function'
      || !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  readonly freshnessForecast = this.previewData.freshnessForecast;
  readonly intensityDistribution = this.previewData.intensityDistribution;
  readonly efficiencyTrend = this.previewData.efficiencyTrend;
  readonly powerCurve = this.previewData.powerCurve;
  readonly formTimeline = this.previewData.formTimeline;
  readonly latestFormPoint = this.previewData.latestFormPoint;
}
