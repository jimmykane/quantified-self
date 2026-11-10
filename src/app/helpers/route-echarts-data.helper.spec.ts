import {
  DataAltitude,
  DataAltitudeSmooth,
  DataDistance,
  DataGrade,
  DataGradeSmooth,
  DistanceUnits,
  ElevationUnits,
  RouteInterface,
  XAxisTypes,
} from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import { RouteSegmentDetailView } from './route-detail.helper';
import {
  buildRouteChartPanels,
  getRouteStreamNumericValues,
  ROUTE_CHART_POINT_INDEX_X_AXIS_TYPE,
  routeHasDistanceXAxis,
} from './route-echarts-data.helper';
import { getEventChartSeriesX, getEventChartSeriesY } from './event-echarts-data.helper';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';

describe('route echarts data helper', () => {
  it.each([
    [DistanceUnits.Kilometers, ElevationUnits.Meters, 'm'],
    [DistanceUnits.Miles, ElevationUnits.Meters, 'm'],
    [DistanceUnits.Kilometers, ElevationUnits.Feet, 'ft'],
    [DistanceUnits.Miles, ElevationUnits.Feet, 'ft'],
  ] as const)('uses %s / %s preferences for route chart labels without converting recorded samples', (distanceUnits, elevationUnits, expectedUnit) => {
    const streams = {
      [DataDistance.type]: [0, 1000, 2000],
      [DataAltitudeSmooth.type]: [30.48, null, 123.456789],
      [DataGradeSmooth.type]: [1, 2, 3],
    };
    const original = structuredClone(streams);
    const segment = createSegment('segment-1', createRoute(streams));
    const result = buildRouteChartPanels([segment], normalizeUserUnitSettings({ distanceUnits, elevationUnits }));
    const [altitude, grade] = result.panels;
    expect(altitude.unit).toBe(expectedUnit);
    expect(altitude.series[0].unit).toBe(expectedUnit);
    expect(altitude.series[0].streamType).toBe(DataAltitudeSmooth.type);
    expect(getEventChartSeriesY(altitude.series[0], 0)).toBe(30.48);
    expect(getEventChartSeriesY(altitude.series[0], 1)).toBeNull();
    expect(getEventChartSeriesY(altitude.series[0], 2)).toBe(123.456789);
    expect(getEventChartSeriesX(altitude.series[0], 1)).toBe(1000);
    expect(grade.unit).toBe('%');
    expect(grade.series[0].unit).toBe('%');
    expect(altitude.series[0].gradeColorValues?.[1]).toBe(2);
    expect(streams).toEqual(original);
  });

  it('builds elevation and grade panels using distance as the x-axis when available', () => {
    const segment = createSegment('segment-1', createRoute({
      [DataDistance.type]: [0, 1000, 2000],
      [DataAltitudeSmooth.type]: [100, 110, 120],
      [DataGradeSmooth.type]: [1, 2, 3],
    }));

    const result = buildRouteChartPanels([segment], null);

    expect(result.xAxisType).toBe(XAxisTypes.Distance);
    expect(result.usesDistanceXAxis).toBe(true);
    expect(result.panels.map(panel => panel.dataType)).toEqual([DataAltitude.type, DataGrade.type]);
    expect(result.panels.every(panel => panel.series.every(series => series.lineGapPolicy === 'adjacent'))).toBe(true);
    expect(result.panels[0].series[0].streamType).toBe(DataAltitudeSmooth.type);
    expect(getEventChartSeriesX(result.panels[0].series[0], 1)).toBe(1000);
    expect(getEventChartSeriesY(result.panels[0].series[0], 1)).toBe(110);
    expect(result.panels[0].series[0].gradeColorValues?.[1]).toBe(2);
  });

  it('falls back to point index when any selected segment lacks distance data', () => {
    const withDistance = createSegment('segment-1', createRoute({
      [DataDistance.type]: [0, 1000],
      [DataAltitude.type]: [100, 110],
    }));
    const withoutDistance = createSegment('segment-2', createRoute({
      [DataAltitude.type]: [200, 210],
      [DataGrade.type]: [4, 5],
    }));

    const result = buildRouteChartPanels([withDistance, withoutDistance], null);

    expect(result.xAxisType).toBe(ROUTE_CHART_POINT_INDEX_X_AXIS_TYPE);
    expect(result.usesDistanceXAxis).toBe(false);
    expect(getEventChartSeriesX(result.panels[0].series[0], 1)).toBe(1);
    expect(getEventChartSeriesX(result.panels[0].series[1], 1)).toBe(1);
  });

  it('handles missing streams without crashing', () => {
    const result = buildRouteChartPanels([
      createSegment('segment-1', createRoute({ [DataDistance.type]: [0, 1, 2] })),
    ], null);

    expect(result.panels).toEqual([]);
  });

  it('reads route stream numeric values and ignores missing stream errors', () => {
    const route = createRoute({
      [DataDistance.type]: [0, null, 2000],
    });

    expect(routeHasDistanceXAxis(route)).toBe(true);
    expect(getRouteStreamNumericValues(route, DataDistance.type)).toEqual([0, Number.NaN, 2000]);
    expect(getRouteStreamNumericValues(route, DataGrade.type)).toEqual([]);
  });

  function createSegment(id: string, route: RouteInterface): RouteSegmentDetailView {
    return {
      id,
      label: id,
      activityType: 'Running',
      color: '#1e88e5',
      route,
      positions: [],
      pointCount: 0,
      distance: { label: '-', rawValue: null, title: '' },
      ascent: { label: '-', rawValue: null, title: '' },
      descent: { label: '-', rawValue: null, title: '' },
      minGrade: { label: '-', rawValue: null, title: '' },
      maxGrade: { label: '-', rawValue: null, title: '' },
    };
  }

  function createRoute(streams: Record<string, Array<number | null>>): RouteInterface {
    return {
      getStream: vi.fn((type: string) => {
        const data = streams[type];
        if (!data) {
          throw new Error(`Missing stream ${type}`);
        }
        return {
          type,
          getData: () => data,
        };
      }),
    } as unknown as RouteInterface;
  }
});
