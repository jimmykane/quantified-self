import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
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
import type { EventChartRange } from '../../helpers/event-chart-range.helper';
import { DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS } from '../../helpers/echarts-tooltip-interaction.helper';
import { SharedModule } from '../../modules/shared.module';
import { AppThemeService } from '../../services/app.theme.service';
import { AppActivityTypeGroupGradients } from '../../services/color/app.activity-type-group.gradients';
import { AppColors } from '../../services/color/app.colors';
import { AppDataColors } from '../../services/color/app.data.colors';
import { EventCadencePowerComponent } from '../event/cadence-power/event.cadence-power.component';
import { EventDurabilityCurveComponent } from '../event/durability-curve/event.durability-curve.component';
import { EventIntensityZonesComponent } from '../event/intensity-zones/event.intensity-zones.component';
import { buildHomeWorkoutPerformancePreviewActivity } from './home-workout-performance-preview.data';

const PREVIEW_DURATION_SECONDS = 3_258;
const PREVIEW_ZOOM_RANGE: EventChartRange = { start: 1_040, end: 2_260 };
const PREVIEW_ZOOM_DELAY_MS = 900;
const PREVIEW_ZOOM_DURATION_MS = 720;
const PREVIEW_ZOOM_HOLD_MS = 1_000;
const PREVIEW_ZOOM_STEPS = 8;
const DIVE_PROFILE_COLORS = AppActivityTypeGroupGradients[ActivityTypeGroups.DivingGroup];
const INTENSITY_ZONE_COLORS = [
  AppColors.LightBlue,
  AppColors.Blue,
  AppColors.Green,
  AppColors.Yellow,
  AppColors.LightestRed,
] as const;

// Whole-workout mean bins from FITfileR's public Zwift/Garmin chest-strap example:
// https://github.com/grimbough/FITfileR/blob/master/inst/extdata/Activities/zwift-turbo.fit
const RIDE_HEART_RATE = [
  86, 105, 107, 108, 108, 87, 95, 100, 115, 116,
  121, 123, 126, 130, 137, 154, 158, 143, 140, 153,
  161, 163, 160, 148, 142, 151, 154, 155, 156, 152,
  143, 144, 159, 164, 165, 159, 150, 152, 162, 163,
  155, 151, 169, 164, 157, 151, 149, 147, 146, 150,
  149, 147, 146, 145, 145, 143, 148, 143, 139, 139,
  124,
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
      id: `preview-ride::${dataType}`,
      activityID: 'preview-ride',
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
  imports: [
    SharedModule,
    EventCadencePowerComponent,
    EventDurabilityCurveComponent,
    EventIntensityZonesComponent,
  ],
})
export class HomeWorkoutPreviewComponent implements AfterViewInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly themeService = inject(AppThemeService);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly animationTimers = new Set<ReturnType<typeof setTimeout>>();
  private viewportObserver: IntersectionObserver | undefined;
  private hasPlayedAnimation = false;

  readonly darkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);
  readonly mobileTapFeedbackOptions = DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS;
  readonly performancePreviewActivities = [buildHomeWorkoutPerformancePreviewActivity({
    durationSeconds: PREVIEW_DURATION_SECONDS,
    heartRateBins: RIDE_HEART_RATE,
    powerBins: RIDE_POWER,
  })];
  readonly animationsEnabled = isPlatformBrowser(this.platformId)
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  readonly xAxisType = XAxisTypes.Duration;
  readonly cursorBehaviour = ChartCursorBehaviours.ZoomX;
  readonly xDomain = { start: 0, end: PREVIEW_DURATION_SECONDS };
  readonly sharedZoomRange = signal<EventChartRange | null>(null);
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
    { zoneLowerLimits: [107, 125, 142, 160] },
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

  ngAfterViewInit(): void {
    if (!this.animationsEnabled) {
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      this.startAnimationOnce();
      return;
    }

    this.viewportObserver = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) {
        return;
      }

      this.viewportObserver?.disconnect();
      this.viewportObserver = undefined;
      this.startAnimationOnce();
    }, { threshold: 0.1 });
    this.viewportObserver.observe(this.elementRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.viewportObserver?.disconnect();
    this.viewportObserver = undefined;
    this.animationTimers.forEach(timer => clearTimeout(timer));
    this.animationTimers.clear();
  }

  private startAnimationOnce(): void {
    if (this.hasPlayedAnimation) {
      return;
    }

    this.hasPlayedAnimation = true;
    this.sharedZoomRange.set(null);

    this.scheduleAnimationStep(PREVIEW_ZOOM_DELAY_MS, () => {
      this.animateZoomRange(null, PREVIEW_ZOOM_RANGE, PREVIEW_ZOOM_DURATION_MS);
    });

    this.scheduleAnimationStep(
      PREVIEW_ZOOM_DELAY_MS
        + PREVIEW_ZOOM_DURATION_MS
        + PREVIEW_ZOOM_HOLD_MS,
      () => {
        this.animateZoomRange(PREVIEW_ZOOM_RANGE, null, PREVIEW_ZOOM_DURATION_MS);
      },
    );
  }

  private animateZoomRange(
    from: EventChartRange | null,
    to: EventChartRange | null,
    durationMs: number,
  ): void {
    const fromRange = from || this.xDomain;
    const toRange = to || this.xDomain;

    for (let step = 1; step <= PREVIEW_ZOOM_STEPS; step += 1) {
      this.scheduleAnimationStep((durationMs / PREVIEW_ZOOM_STEPS) * step, () => {
        if (step === PREVIEW_ZOOM_STEPS) {
          this.sharedZoomRange.set(to);
          return;
        }

        const progress = step / PREVIEW_ZOOM_STEPS;
        const easedProgress = 1 - ((1 - progress) ** 3);
        this.sharedZoomRange.set({
          start: this.interpolateRangeValue(fromRange.start, toRange.start, easedProgress),
          end: this.interpolateRangeValue(fromRange.end, toRange.end, easedProgress),
        });
      });
    }
  }

  private interpolateRangeValue(start: number, end: number, progress: number): number {
    return Math.round(start + ((end - start) * progress));
  }

  private scheduleAnimationStep(delayMs: number, callback: () => void): void {
    const timer = setTimeout(() => {
      this.animationTimers.delete(timer);
      callback();
    }, delayMs);
    this.animationTimers.add(timer);
  }
}
