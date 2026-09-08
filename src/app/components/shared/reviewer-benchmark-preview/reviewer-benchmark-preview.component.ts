import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AppThemes, ChartCursorBehaviours, XAxisTypes } from '@sports-alliance/sports-lib';
import { DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS } from '../../../helpers/echarts-tooltip-interaction.helper';
import { SharedModule } from '../../../modules/shared.module';
import { AppThemeService } from '../../../services/app.theme.service';
import { CompactRowComponent } from '../compact-row/compact-row.component';
import {
  REVIEWER_BENCHMARK_ALTITUDE_PANEL,
  REVIEWER_BENCHMARK_DURATION_SECONDS,
  REVIEWER_BENCHMARK_HEART_RATE_PANEL,
} from './reviewer-benchmark-chart-preview.data';

@Component({
  selector: 'app-reviewer-benchmark-preview',
  standalone: true,
  imports: [MatIconModule, CompactRowComponent, SharedModule],
  templateUrl: './reviewer-benchmark-preview.component.html',
  styleUrls: ['./reviewer-benchmark-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewerBenchmarkPreviewComponent {
  private readonly themeService = inject(AppThemeService);

  readonly darkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);
  readonly heartRatePanel = REVIEWER_BENCHMARK_HEART_RATE_PANEL;
  readonly altitudePanel = REVIEWER_BENCHMARK_ALTITUDE_PANEL;
  readonly xAxisType = XAxisTypes.Duration;
  readonly xDomain = { start: 0, end: REVIEWER_BENCHMARK_DURATION_SECONDS };
  readonly cursorBehaviour = ChartCursorBehaviours.ZoomX;
  readonly mobileTapFeedbackOptions = DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS;
}
