import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { CustomSeriesOption } from 'echarts/charts';
import type { EChartsType } from 'echarts/core';
import { buildDashboardEChartsStyleTokens, buildDashboardEChartsTooltipChrome, renderDashboardEChartsTooltipCard } from './dashboard-echarts-style.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY } from './echarts-theme.helper';
import { resolveEChartsTooltipSurfaceConfig, resolveEChartsTooltipTriggerOn } from './echarts-tooltip-interaction.helper';
import { formatWorkoutProfileAxis, WORKOUT_PROFILE_PURPOSE_SHORT_LABELS, type WorkoutProfileMetric, type WorkoutProfileModel } from './workout-profile.helper';

export function buildWorkoutProfileChartOption(model: WorkoutProfileModel, metric: WorkoutProfileMetric | null,
  selectedKey: string | null, changedStepIds: readonly string[], dark: boolean, width: number,
  mobile: boolean, units?: UserUnitSettingsInterface | null, locale?: string): Parameters<EChartsType['setOption']>[0] {
  const style = buildDashboardEChartsStyleTokens(dark, width);
  const bandValues = model.occurrences.flatMap(step => step.targets.filter(t => t.metric === metric));
  const maximum = Math.max(1, ...bandValues.map(t => t.maximum));
  const minimum = metric === 'pace' ? Math.min(...bandValues.map(t => t.minimum)) * .95 : 0;
  const upper = Number.isFinite(maximum * 1.05) ? maximum * 1.05 : maximum;
  const purposeGrid = metric ? 1 : 0;
  const series: CustomSeriesOption[] = [];
  if (metric) {
    series.push({ type: 'custom', name: 'Target range', xAxisIndex: 0, yAxisIndex: 0, clip: true,
      encode: { x: 0, y: [1, 2] },
      data: model.occurrences.flatMap((step, i) => step.targets.filter(t => t.metric === metric)
        .map(t => ({ value: [i, t.minimum, t.maximum], occurrenceKey: step.occurrenceKey }))),
      renderItem: (params, api) => {
        const index = Number(api.value(0));
        const step = model.occurrences[index];
        const low = api.coord([index, Number(api.value(1))]);
        const high = api.coord([index, Number(api.value(2))]);
        const size = api.size([1, 0]) as number[];
        const selected = step.occurrenceKey === selectedKey;
        const relative = bandValues[params.dataIndex]?.relative;
        return { type: 'rect', shape: { x: low[0] - size[0] * .4, y: Math.min(low[1], high[1]) - 2,
          width: size[0] * .8, height: Math.max(4, Math.abs(low[1] - high[1])) },
        style: { fill: style.trendLineColor, opacity: selected ? .85 : .5, stroke: style.textColor,
          lineWidth: selected ? 3 : 1, lineDash: relative ? [5, 3] : undefined } };
      },
    });
  }
  series.push({ type: 'custom', name: 'Step purpose', xAxisIndex: purposeGrid, yAxisIndex: purposeGrid,
    encode: { x: 0, y: 1 }, data: model.occurrences.map((step, i) => ({ value: [i, .5], occurrenceKey: step.occurrenceKey })),
    renderItem: (_params, api) => {
      const index = Number(api.value(0));
      const step = model.occurrences[index];
      const point = api.coord([index, .5]);
      const size = api.size([1, 0]) as number[];
      const selected = step.occurrenceKey === selectedKey;
      const changed = changedStepIds.includes(step.stepId) || changedStepIds.includes(step.repeatId);
      return { type: 'group', children: [
        { type: 'rect', shape: { x: point[0] - size[0] * .4, y: point[1] - 15, width: size[0] * .8, height: 30 },
          style: { fill: style.gridColor, stroke: style.textColor, lineWidth: selected ? 3 : 1,
            lineDash: changed ? [2, 2] : undefined } },
        { type: 'text', style: { x: point[0], y: point[1], text: WORKOUT_PROFILE_PURPOSE_SHORT_LABELS[step.purpose],
          align: 'center', verticalAlign: 'middle', fill: style.textColor, fontSize: 12,
          fontWeight: selected ? 'bold' : 'normal', fontFamily: ECHARTS_GLOBAL_FONT_FAMILY } },
      ] };
    },
  });
  const xAxis = { type: 'category' as const, data: model.occurrences.map(step => String(step.ordinal)),
    axisTick: { show: false }, axisLine: { show: false }, splitLine: { show: false },
    axisLabel: { color: style.secondaryTextColor, interval: 0 } };
  return {
    animation: false, backgroundColor: 'transparent', textStyle: { fontFamily: ECHARTS_GLOBAL_FONT_FAMILY },
    grid: metric ? [{ left: 88, right: 8, top: 12, height: 170 }, { left: 88, right: 8, top: 202, height: 36 }]
      : [{ left: 8, right: 8, top: 16, height: 36 }],
    xAxis: metric ? [{ ...xAxis, axisLabel: { show: false } }, { ...xAxis, gridIndex: 1 }] : [xAxis],
    yAxis: metric ? [{ type: 'value', min: minimum, max: upper, inverse: metric === 'pace', splitNumber: 3,
      axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: style.gridColor } },
      axisLabel: { color: style.secondaryTextColor, fontSize: 12,
        formatter: (value: number) => formatWorkoutProfileAxis(value, metric, model.structure, units, locale) } },
    { type: 'value', gridIndex: 1, min: 0, max: 1, show: false }]
      : [{ type: 'value', min: 0, max: 1, show: false }],
    tooltip: { trigger: 'item', triggerOn: resolveEChartsTooltipTriggerOn(true, mobile),
      // A horizontally scrollable chart can exceed the phone viewport. Use the shared viewport-bound tooltip host.
      ...resolveEChartsTooltipSurfaceConfig(false), ...buildDashboardEChartsTooltipChrome(style),
      formatter: (param: { value?: number[] }) => {
        const step = model.occurrences[param?.value?.[0]];
        if (!step) return '';
        return renderDashboardEChartsTooltipCard(style, { title: step.label, stackHeader: true,
          rows: [{ label: 'End', value: step.ending }, ...step.targets.map(t => ({ label: t.metric === 'heart-rate' ? 'Heart rate' : t.metric, value: t.text })),
            ...(step.targets.length === 0 ? [{ label: 'Target', value: 'No target prescribed' }] : []),
            ...(step.note ? [{ label: 'Note', value: step.note }] : [])],
        });
      },
    },
    series,
  };
}
