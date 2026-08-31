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

// One anonymized hilly ride profile shared by every training chart. Power reacts
// immediately to terrain, while heart rate rises and recovers more gradually.
const RIDE_HEART_RATE = [
  120, 121, 119, 121, 116, 109, 102, 101, 101, 101,
  102, 102, 97, 96, 98, 99, 102, 106, 107, 106,
  107, 109, 112, 112, 110, 106, 101, 102, 106, 111,
  116, 121, 121, 121, 122, 126, 131, 136, 141, 145,
  149, 151, 151, 148, 144, 136, 131, 129, 129, 132,
  137, 138, 138, 135, 131, 127, 122, 120, 122, 122,
  123,
] as const;

const RIDE_ALTITUDE = [
  491, 490, 490, 492, 493, 495, 496, 496, 496, 498,
  501, 501, 500, 500, 499, 502, 503, 504, 505, 506,
  506, 507, 509, 512, 514, 513, 513, 513, 513, 514,
  516, 517, 518, 521, 523, 526, 530, 534, 538, 542,
  547, 552, 557, 559, 562, 564, 565, 567, 571, 575,
  578, 581, 583, 587, 589, 589, 591, 592, 593, 597,
  596,
] as const;

const RIDE_GRADE = [
  0, 0, 1, 2, 3, 1, 1, 1, 3, 3,
  2, -2, -4, -4, 0, 2, 2, 2, 1, 1,
  0, 1, 3, 4, 2, -1, -2, -1, 0, 1,
  1, 2, 2, 5, 6, 8, 9, 10, 10, 12,
  11, 11, 8, 6, 5, 2, 4, 6, 10, 10,
  8, 7, 6, 5, 4, 2, 1, 1, 2, 12,
  12,
] as const;

const RIDE_POWER = [
  239, 191, 124, 75, 95, 79, 145, 222, 238, 191,
  114, 89, 115, 162, 182, 147, 90, 122, 121, 87,
  78, 106, 110, 101, 55, 100, 177, 295, 298, 189,
  115, 110, 142, 133, 149, 176, 210, 211, 212, 245,
  256, 232, 184, 136, 137, 83, 163, 188, 218, 203,
  157, 196, 134, 112, 80, 77, 79, 115, 105, 130,
  85,
] as const;

interface PreviewPanelOptions {
  gradeValues?: readonly number[];
  zoneLowerLimits?: readonly number[];
}

function buildZoneColorPieces(lowerLimits: readonly number[]): EventChartZoneColorPiece[] {
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
  values: readonly number[],
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
    RIDE_HEART_RATE,
    { zoneLowerLimits: [110, 125, 140, 150] },
  );

  readonly altitudePanel = buildPanel(
    DataAltitude.type,
    'Altitude',
    'm',
    AppDataColors.Altitude,
    RIDE_ALTITUDE,
    { gradeValues: RIDE_GRADE },
  );

  readonly powerPanel = buildPanel(
    DataPower.type,
    'Power',
    'W',
    AppDataColors.Power,
    RIDE_POWER,
    { zoneLowerLimits: [100, 150, 200, 250] },
  );

  readonly depthPanel = buildPanel(
    DataDepth.type,
    'Depth',
    'm',
    AppDataColors.Depth,
    [0.5, 1.5, 4, 8, 13, 18, 21, 20, 16, 10, 4, 0.5],
  );
}
