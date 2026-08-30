import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  ActivityTypeGroups,
  AppThemes,
  ChartCursorBehaviours,
  DataAltitude,
  DataDepth,
  DataHeartRate,
  DataPower,
  XAxisTypes,
} from '@sports-alliance/sports-lib';
import type {
  EventChartPanelModel,
  EventChartZoneColorPiece,
} from '../../helpers/event-echarts-data.helper';
import { SharedModule } from '../../modules/shared.module';
import { AppThemeService } from '../../services/app.theme.service';
import { AppActivityTypeGroupGradients } from '../../services/color/app.activity-type-group.gradients';
import { AppColors } from '../../services/color/app.colors';
import { AppDataColors } from '../../services/color/app.data.colors';

const PREVIEW_DURATION_SECONDS = 3_258;
const DIVE_PROFILE_COLORS = AppActivityTypeGroupGradients[ActivityTypeGroups.DivingGroup];
const INTENSITY_ZONE_COLORS = [
  AppColors.LightBlue,
  AppColors.Blue,
  AppColors.Green,
  AppColors.Yellow,
  AppColors.LightestRed,
] as const;

interface PreviewPanelOptions {
  gradeValues?: number[];
  zoneLowerLimits?: number[];
}

function buildZoneColorPieces(lowerLimits: number[]): EventChartZoneColorPiece[] {
  return INTENSITY_ZONE_COLORS.slice(0, lowerLimits.length + 1).map((color, index) => ({
    zone: `Zone ${index + 1}`,
    color,
    ...(index > 0 ? { gte: lowerLimits[index - 1] } : {}),
    ...(Number.isFinite(lowerLimits[index]) ? { lt: lowerLimits[index] } : {}),
  }));
}

function buildPanel(
  dataType: string,
  displayName: string,
  unit: string,
  color: string,
  values: number[],
  options: PreviewPanelOptions = {},
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
      ...(options.gradeValues ? {
        gradeColorValues: new Float64Array(options.gradeValues),
        gradeColorSourceType: 'Grade Smooth',
      } : {}),
      ...(options.zoneLowerLimits ? {
        zoneColorPieces: buildZoneColorPieces(options.zoneLowerLimits),
      } : {}),
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
  readonly depthAreaFillOrigin = 'start' as const;
  readonly depthFillColor = computed(() => (
    this.darkTheme() ? DIVE_PROFILE_COLORS.start : DIVE_PROFILE_COLORS.end
  ));

  readonly heartRatePanel = buildPanel(
    DataHeartRate.type,
    'Heart Rate',
    'bpm',
    AppDataColors['Heart Rate'],
    [112, 126, 139, 147, 143, 158, 151, 174, 163, 148, 136, 128],
    { zoneLowerLimits: [120, 140, 155, 170] },
  );

  readonly altitudePanel = buildPanel(
    DataAltitude.type,
    'Altitude',
    'm',
    AppDataColors.Altitude,
    [92, 98, 109, 127, 151, 184, 207, 222, 210, 188, 156, 132],
    { gradeValues: [1, 2, 4, 7, 10, 13, 8, 5, 1, -2, -4, -1] },
  );

  readonly powerPanel = buildPanel(
    DataPower.type,
    'Power',
    'W',
    AppDataColors.Power,
    [138, 184, 212, 196, 258, 221, 318, 205, 279, 189, 172, 142],
    { zoneLowerLimits: [150, 200, 250, 300] },
  );

  readonly depthPanel = buildPanel(
    DataDepth.type,
    'Depth',
    'm',
    AppDataColors.Depth,
    [0.5, 1.5, 4, 8, 13, 18, 21, 20, 16, 10, 4, 0.5],
  );
}
