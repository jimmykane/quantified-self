import { describe, expect, it } from 'vitest';
import {
  ActivityTypes, DataDistance, DataPower, DataPowerAvg, DataPowerLeft, DataPowerRight,
  EventImporterJSON, Stream, XAxisTypes,
} from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
import {
  buildEventChartPanels, buildEventChartPanelsFromSnapshot, canConnectEventChartPoints,
  createEventChartPanelBuildSnapshot, eventChartSeriesToPoints, type BuildEventChartPanelsInput,
} from './event-echarts-data.helper';
import { computeEventPanelRangeStats } from './event-echarts-range-stats.helper';
import { buildEventPowerDisplay } from './event-power-display.helper';

const watts = [100, null, 0, 300, 300, 300, null, 0];
function input(xAxisType: XAxisTypes, mode: 'continuous' | 'custom'): BuildEventChartPanelsInput {
  const activity = EventImporterJSON.getActivityFromJSON({
    name: 'Synthetic ride', startDate: 0, endDate: 7000, type: ActivityTypes.Cycling,
    creator: { name: 'Synthetic', devices: [] }, powerMeter: true, trainer: false,
    stats: { [DataPowerAvg.type]: 222 }, laps: [], intensityZones: [], events: [],
    streams: [{ type: DataPower.type, data: [...watts] },
      { type: DataPowerLeft.type, data: watts.map(value => value === null ? null : value / 2) },
      { type: DataPowerRight.type, data: watts.map(value => value === null ? null : value / 2) },
      { type: DataDistance.type, data: [0, 10, 20, 30, 40, 50, 60, 70] }],
  });
  // Native JSON intentionally omits Time; source hydration provides it before charting.
  activity.addStream(new Stream(XAxisTypes.Time, watts.map((_, index) => index)));
  activity.setID('synthetic');
  return { selectedActivities: [activity], allActivities: [activity], xAxisType,
    showAllData: false, dataTypesToUse: [DataPower.type, DataPowerLeft.type, DataPowerRight.type],
    userUnitSettings: getDefaultUserUnitSettings(), lineContinuity: { mode, maxGapSeconds: 1 },
    eventColorService: { getActivityColor: () => '#123456' } as BuildEventChartPanelsInput['eventColorService'] };
}

describe('power adoption in Event Details', () => {
  it.each([XAxisTypes.Time, XAxisTypes.Duration, XAxisTypes.Distance])(
    'preserves missing and zero watts through %s worker packing, line settings, zoom stats and 3s display', axis => {
      for (const mode of ['continuous', 'custom'] as const) {
        const request = input(axis, mode);
        const activity = request.selectedActivities[0];
        const before = JSON.stringify(activity.toJSON());
        const direct = buildEventChartPanels(request);
        const worker = buildEventChartPanelsFromSnapshot(createEventChartPanelBuildSnapshot(request));
        expect(worker.map(panel => panel.dataType)).toEqual(direct.map(panel => panel.dataType));
        for (const panels of [direct, worker]) {
          for (const type of [DataPower.type, DataPowerLeft.type, DataPowerRight.type]) {
            const panel = panels.find(panel => panel.dataType === type)!;
            expect(panel, `Missing ${type}; panels: ${panels.map(item => item.dataType).join(', ')}`).toBeDefined();
            const series = panel.series[0];
            const scale = type === DataPower.type ? 1 : 2;
            const points = eventChartSeriesToPoints(series);
            expect(points.map(point => point.y)).toEqual(watts.map(value => value === null ? null : value / scale));
            expect(canConnectEventChartPoints(series, 0, 2)).toBe(mode === 'continuous');
            const stats = computeEventPanelRangeStats({ panel, range: { start: panel.minX, end: panel.maxX },
              xAxisType: axis, gainAndLossThreshold: 0, userUnitSettings: request.userUnitSettings });
            const expected = new DataPower(1000 / 6 / scale);
            expect(stats[0].min.value).toBe(String(new DataPower(0).getDisplayValue()));
            expect(stats[0].avg).toEqual({ value: String(expected.getDisplayValue()), unit: expected.getDisplayUnit() });
            const missing = computeEventPanelRangeStats({ panel,
              range: { start: (points[0].x + points[1].x) / 2, end: (points[1].x + points[2].x) / 2 },
              xAxisType: axis, gainAndLossThreshold: 0 });
            expect(missing).toEqual([]);
            const average = buildEventPowerDisplay(series);
            expect(Array.from(average.lineValues).filter((_, index) => index % 2 === 1))
              .toEqual([NaN, NaN, NaN, NaN, 200 / scale, 300 / scale, NaN, NaN]);
          }
        }
        expect(activity.getStat(DataPowerAvg.type)?.getValue()).toBe(222);
        expect(JSON.stringify(activity.toJSON())).toBe(before);
      }
    },
  );
});
