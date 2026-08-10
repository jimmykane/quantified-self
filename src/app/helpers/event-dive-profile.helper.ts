import {
  ActivityInterface,
  ActivityTypeGroups,
  ActivityTypesHelper,
  DataDepth,
  DataDepthFeet,
  DataDepthMax,
  DataHeartRate,
  DataInterface,
  DataTemperature,
  DynamicDataLoader,
  UserUnitSettingsInterface,
  XAxisTypes,
} from '@sports-alliance/sports-lib';
import type { AppEventColorService } from '../services/color/app.event.color.service';
import {
  buildEventChartPanels,
  getEventChartSeriesPointCount,
  getEventChartSeriesX,
  getEventChartSeriesY,
} from './event-echarts-data.helper';
import { buildEventPanelYAxisConfig } from './event-echarts-yaxis.helper';
import { buildEventEChartsVisualTokens } from './event-echarts-common.helper';
import { formatDurationSeconds } from './event-echarts-xaxis.helper';
import type { EventChartPanelModel, EventChartPanelSeries } from './event-echarts-data.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY } from './echarts-theme.helper';
import {
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn,
} from './echarts-tooltip-interaction.helper';

const DIVE_PROFILE_DEPTH_TYPES = new Set([DataDepth.type, DataDepthFeet.type]);

export interface EventDiveProfileModel {
  activities: ActivityInterface[];
  depthPanel: EventChartPanelModel;
  temperaturePanel: EventChartPanelModel | null;
  heartRatePanel: EventChartPanelModel | null;
  maximumDepth: number | null;
}

export interface BuildEventDiveProfileInput {
  activities: ActivityInterface[];
  userUnitSettings: UserUnitSettingsInterface;
  eventColorService: AppEventColorService;
}

export interface BuildEventDiveProfileChartOptionInput {
  model: EventDiveProfileModel;
  showTemperature: boolean;
  showHeartRate: boolean;
  darkTheme: boolean;
  isMobile: boolean;
  useAnimations: boolean;
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
    return (depthStream?.getData?.() || []).some((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0);
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
    maximumDepth: resolveMaximumDepth(activities, depthPanel, input.userUnitSettings),
  };
}

export function buildEventDiveProfileChartOption(input: BuildEventDiveProfileChartOptionInput): Record<string, unknown> {
  const { model } = input;
  const chartStyle = buildEventEChartsVisualTokens(input.darkTheme, input.isMobile);
  const visiblePanels = [
    model.depthPanel,
    ...(input.showTemperature && model.temperaturePanel ? [model.temperaturePanel] : []),
    ...(input.showHeartRate && model.heartRatePanel ? [model.heartRatePanel] : []),
  ];
  const allSeries = visiblePanels.flatMap((panel) => panel.series);
  const depthAxis = buildEventPanelYAxisConfig({ panel: model.depthPanel, visibleRange: null });
  const depthAxisMax = resolveDepthAxisMaximum(depthAxis.max, depthAxis.interval, model.maximumDepth);
  const yAxes = visiblePanels.map((panel, index) => ({
    type: 'value',
    name: `${panel.displayName} (${panel.unit})`,
    position: index === 0 ? 'left' : 'right',
    offset: index <= 1 ? 0 : 52,
    inverse: index === 0 ? depthAxis.inverse : false,
    ...(index === 0 ? {
      min: depthAxis.min,
      max: depthAxisMax,
      interval: depthAxis.interval,
    } : {}),
    nameLocation: 'middle',
    nameGap: index === 0 ? 42 : 46,
    nameTextStyle: {
      color: chartStyle.textColor,
      fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
    },
    axisLine: { lineStyle: { color: chartStyle.axisColor } },
    axisTick: { show: false },
    splitLine: {
      show: index === 0,
      lineStyle: { color: chartStyle.gridColor },
    },
    axisLabel: {
      color: chartStyle.textColor,
      fontSize: chartStyle.axisLabelFontSize,
      formatter: (value: number) => formatDiveMetricValue(panel.dataType, value),
    },
  }));

  let firstDepthSeries = true;
  const series = visiblePanels.flatMap((panel, panelIndex) => panel.series.map((entry) => {
    const isDepth = DIVE_PROFILE_DEPTH_TYPES.has(panel.dataType);
    const markLine = isDepth && firstDepthSeries && model.maximumDepth !== null
      ? {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', width: 1.2, color: entry.color },
          label: {
            show: true,
            position: 'insideEndTop',
            formatter: `Max ${formatDiveMetricValue(panel.dataType, model.maximumDepth)} ${panel.unit}`,
            color: chartStyle.textColor,
          },
          data: [{ yAxis: model.maximumDepth }],
        }
      : undefined;
    if (isDepth) {
      firstDepthSeries = false;
    }
    return {
      id: `dive-profile:${entry.id}`,
      name: buildDiveSeriesName(panel, entry, allSeries.length),
      type: 'line',
      yAxisIndex: panelIndex,
      data: toEChartsSeriesData(entry, isDepth),
      showSymbol: false,
      connectNulls: false,
      smooth: false,
      sampling: 'none',
      animation: input.useAnimations,
      lineStyle: { color: entry.color, width: isDepth ? 2 : 1.5 },
      itemStyle: { color: entry.color },
      emphasis: { focus: allSeries.length > 1 ? 'series' : 'none' },
      ...(markLine ? { markLine } : {}),
    };
  }));

  return {
    animation: input.useAnimations,
    backgroundColor: 'transparent',
    textStyle: {
      color: chartStyle.textColor,
      fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
    },
    legend: {
      show: allSeries.length > 1,
      top: 0,
      left: 'center',
      textStyle: {
        color: chartStyle.textColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
        fontSize: input.isMobile ? 11 : 12,
      },
    },
    grid: {
      left: 4,
      right: visiblePanels.length > 2 ? 112 : visiblePanels.length > 1 ? 58 : 6,
      top: allSeries.length > 1 ? 28 : 4,
      bottom: 8,
      outerBoundsMode: 'same',
      outerBoundsContain: 'axisLabel',
    },
    xAxis: {
      type: 'value',
      min: 0,
      name: 'Elapsed time',
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: {
        color: chartStyle.textColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
      },
      axisLine: { lineStyle: { color: chartStyle.axisColor } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        color: chartStyle.textColor,
        fontSize: chartStyle.axisLabelFontSize,
        formatter: (value: number) => formatDurationSeconds(value),
      },
    },
    yAxis: yAxes,
    tooltip: {
      trigger: 'axis',
      triggerOn: resolveEChartsTooltipTriggerOn(true, input.isMobile),
      renderMode: 'html',
      ...resolveEChartsTooltipSurfaceConfig(input.isMobile),
      extraCssText: chartStyle.tooltipExtraCssText,
      backgroundColor: chartStyle.tooltipBackgroundColor,
      borderColor: chartStyle.tooltipBorderColor,
      borderWidth: 1,
      textStyle: {
        color: chartStyle.tooltipTextColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
      },
      formatter: formatDiveProfileTooltip,
    },
    series,
  };
}

function resolveDepthAxisMaximum(
  axisMaximum: number | undefined,
  interval: number | undefined,
  maximumDepth: number | null,
): number | undefined {
  if (maximumDepth === null || !Number.isFinite(maximumDepth)) {
    return axisMaximum;
  }
  if (axisMaximum !== undefined && axisMaximum >= maximumDepth) {
    return axisMaximum;
  }
  if (interval !== undefined && interval > 0) {
    return Math.ceil((maximumDepth * 1.05) / interval) * interval;
  }
  return maximumDepth;
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

function resolveMaximumDepth(
  activities: ActivityInterface[],
  depthPanel: EventChartPanelModel,
  unitSettings: UserUnitSettingsInterface,
): number | null {
  const statValues = activities
    .map((activity) => activity.getStat?.(DataDepthMax.type))
    .map((stat) => convertDepthStat(stat, depthPanel.dataType, unitSettings))
    .filter((value): value is number => value !== null && value >= 0);
  if (statValues.length > 0) {
    return Math.max(...statValues);
  }

  let maximumDepth: number | null = null;
  depthPanel.series.forEach((series) => {
    const pointCount = getEventChartSeriesPointCount(series);
    for (let index = 0; index < pointCount; index += 1) {
      const value = getEventChartSeriesY(series, index);
      if (value !== null && value >= 0 && (maximumDepth === null || value > maximumDepth)) {
        maximumDepth = value;
      }
    }
  });
  return maximumDepth;
}

function convertDepthStat(
  stat: DataInterface | void,
  targetType: string,
  unitSettings: UserUnitSettingsInterface,
): number | null {
  if (!stat) {
    return null;
  }
  try {
    const targetUnit = DynamicDataLoader.getDataClassFromDataType(targetType).unit;
    const converted = DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, unitSettings)
      .find((entry) => entry.getUnit() === targetUnit);
    const value = Number((converted || stat).getValue());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function toEChartsSeriesData(series: EventChartPanelSeries, isDepth: boolean): Array<[number, number | null]> {
  const values: Array<[number, number | null]> = [];
  const pointCount = getEventChartSeriesPointCount(series);
  for (let index = 0; index < pointCount; index += 1) {
    const x = getEventChartSeriesX(series, index);
    const rawY = getEventChartSeriesY(series, index);
    const y = rawY !== null && (!isDepth || rawY >= 0) ? rawY : null;
    if (Number.isFinite(x)) {
      values.push([x, y]);
    }
  }
  return values;
}

function buildDiveSeriesName(
  panel: EventChartPanelModel,
  series: EventChartPanelSeries,
  totalSeriesCount: number,
): string {
  if (totalSeriesCount <= 1) {
    return panel.displayName;
  }
  return `${panel.displayName} · ${series.activityName}`;
}

function formatDiveMetricValue(dataType: string, value: number): string {
  if (!Number.isFinite(value)) {
    return '';
  }
  return dataType === DataHeartRate.type ? Math.round(value).toString() : value.toFixed(2);
}

function formatDiveProfileTooltip(params: unknown): string {
  const entries = Array.isArray(params) ? params as Array<{
    axisValue?: unknown;
    seriesName?: string;
    marker?: string;
    value?: unknown;
  }> : [];
  if (!entries.length) {
    return '';
  }
  const xValue = Number(entries[0]?.axisValue);
  const rows = entries.flatMap((entry) => {
    const tuple = Array.isArray(entry.value) ? entry.value : [];
    const value = Number(tuple[1]);
    if (!Number.isFinite(value)) {
      return [];
    }
    return [`${entry.marker || ''}${escapeHtml(entry.seriesName || 'Series')}: <b>${value.toFixed(2)}</b>`];
  });
  return [`<b>${formatDurationSeconds(xValue)}</b>`, ...rows].join('<br/>');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
