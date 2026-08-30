import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AppThemes, ChartCursorBehaviours, DataHeartRate, DataPower, XAxisTypes } from '@sports-alliance/sports-lib';
import type { EventChartPanelModel } from '../../helpers/event-echarts-data.helper';
import { SharedModule } from '../../modules/shared.module';
import { AppThemeService } from '../../services/app.theme.service';
import { AppDataColors } from '../../services/color/app.data.colors';

const PREVIEW_DURATION_SECONDS = 3_258;

function buildPanel(
  dataType: string,
  displayName: string,
  unit: string,
  color: string,
  values: number[],
): EventChartPanelModel {
  const finalIndex = values.length - 1;
  const points = values.map((value, index) => {
    const x = Math.round((index / finalIndex) * PREVIEW_DURATION_SECONDS);
    return { x, y: value, time: x };
  });

  return {
    dataType,
    displayName,
    unit,
    colorGroupKey: displayName,
    minX: 0,
    maxX: PREVIEW_DURATION_SECONDS,
    series: [{
      id: `illustrative-ride::${dataType}`,
      activityID: 'illustrative-ride',
      activityName: 'Morning Ride',
      color,
      streamType: dataType,
      displayName,
      unit,
      points,
    }],
  };
}

@Component({
  selector: 'app-home-workout-preview',
  templateUrl: './home-workout-preview.component.html',
  styleUrls: ['./home-workout-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [SharedModule],
})
export class HomeWorkoutPreviewComponent {
  private readonly themeService = inject(AppThemeService);

  readonly darkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);
  readonly xAxisType = XAxisTypes.Duration;
  readonly cursorBehaviour = ChartCursorBehaviours.ZoomX;
  readonly xDomain = { start: 0, end: PREVIEW_DURATION_SECONDS };

  readonly heartRatePanel = buildPanel(
    DataHeartRate.type,
    'Heart Rate',
    'bpm',
    AppDataColors['Heart Rate'],
    [112, 126, 139, 147, 143, 155, 151, 162, 149, 144, 136, 128],
  );

  readonly powerPanel = buildPanel(
    DataPower.type,
    'Power',
    'W',
    AppDataColors.Power,
    [138, 184, 212, 196, 238, 221, 265, 205, 248, 189, 172, 142],
  );
}
