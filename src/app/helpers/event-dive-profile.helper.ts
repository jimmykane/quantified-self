import {
  ActivityInterface,
  ActivityTypeGroups,
  ActivityTypesHelper,
  DataDepth,
  DataDepthFeet,
  DataHeartRate,
  DataTemperature,
  UserUnitSettingsInterface,
  XAxisTypes,
} from '@sports-alliance/sports-lib';
import type { AppEventColorService } from '../services/color/app.event.color.service';
import {
  buildEventChartPanels,
  getEventChartSeriesPointCount,
  getEventChartSeriesY,
} from './event-echarts-data.helper';
import type { EventChartPanelModel, EventChartPanelSeries } from './event-echarts-data.helper';

const DIVE_PROFILE_DEPTH_TYPES = new Set([DataDepth.type, DataDepthFeet.type]);

export interface EventDiveProfileModel {
  activities: ActivityInterface[];
  depthPanel: EventChartPanelModel;
  temperaturePanel: EventChartPanelModel | null;
  heartRatePanel: EventChartPanelModel | null;
}

export interface BuildEventDiveProfileInput {
  activities: ActivityInterface[];
  userUnitSettings: UserUnitSettingsInterface;
  eventColorService: AppEventColorService;
}

export function isDivingActivity(activity: ActivityInterface | null | undefined): boolean {
  if (!activity) {
    return false;
  }
  return ActivityTypesHelper.getActivityGroupForActivityType(activity.type) === ActivityTypeGroups.DivingGroup;
}

export function hasEventDiveProfileData(activities: ActivityInterface[]): boolean {
  return (activities || []).some((activity) => {
    if (!isDivingActivity(activity)) {
      return false;
    }
    const depthStream = (activity.getAllStreams?.() || []).find((stream) => stream?.type === DataDepth.type);
    return (depthStream?.getData?.() || []).some((value) => (
      typeof value === 'number' && Number.isFinite(value) && value >= 0
    ));
  });
}

export function buildEventDiveProfile(input: BuildEventDiveProfileInput): EventDiveProfileModel | null {
  const activities = (input.activities || []).filter(isDivingActivity);
  if (!hasEventDiveProfileData(activities)) {
    return null;
  }

  const panels = buildEventChartPanels({
    selectedActivities: activities,
    allActivities: activities,
    xAxisType: XAxisTypes.Duration,
    showAllData: false,
    dataTypesToUse: [DataDepth.type, DataTemperature.type, DataHeartRate.type],
    userUnitSettings: input.userUnitSettings,
    eventColorService: input.eventColorService,
  });
  const rawDepthPanel = panels.find((panel) => DIVE_PROFILE_DEPTH_TYPES.has(panel.dataType));
  const depthPanel = rawDepthPanel ? sanitizeDepthPanel(rawDepthPanel) : null;
  if (!depthPanel?.series.length) {
    return null;
  }

  return {
    activities,
    depthPanel,
    temperaturePanel: panels.find((panel) => panel.dataType === DataTemperature.type) || null,
    heartRatePanel: panels.find((panel) => panel.dataType === DataHeartRate.type) || null,
  };
}

function sanitizeDepthPanel(panel: EventChartPanelModel): EventChartPanelModel {
  const series = panel.series
    .map((entry) => sanitizeDepthSeries(entry))
    .filter((entry) => hasNonNegativeSeriesValue(entry));
  return { ...panel, series };
}

function sanitizeDepthSeries(series: EventChartPanelSeries): EventChartPanelSeries {
  if (series.lineValues instanceof Float64Array) {
    const lineValues = series.lineValues.slice();
    for (let index = 1; index < lineValues.length; index += 2) {
      if (!Number.isFinite(lineValues[index]) || lineValues[index] < 0) {
        lineValues[index] = Number.NaN;
      }
    }
    return { ...series, lineValues };
  }
  return {
    ...series,
    points: (series.points || []).map((point) => ({
      ...point,
      y: typeof point.y === 'number' && Number.isFinite(point.y) && point.y >= 0 ? point.y : null,
    })),
  };
}

function hasNonNegativeSeriesValue(series: EventChartPanelSeries): boolean {
  const pointCount = getEventChartSeriesPointCount(series);
  for (let index = 0; index < pointCount; index += 1) {
    const value = getEventChartSeriesY(series, index);
    if (value !== null && value >= 0) {
      return true;
    }
  }
  return false;
}
