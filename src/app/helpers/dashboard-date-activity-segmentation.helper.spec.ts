import { ChartDataValueTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { DashboardCartesianPoint } from './dashboard-echarts-cartesian.helper';
import { buildDashboardDateActivitySegmentation } from './dashboard-date-activity-segmentation.helper';

describe('dashboard-date-activity-segmentation.helper', () => {
  const dayOne = Date.UTC(2024, 0, 1);
  const dayTwo = Date.UTC(2024, 0, 2);
  const dayThree = Date.UTC(2024, 0, 3);

  const buildPoints = (values: number[]): DashboardCartesianPoint[] => values.map((value, index) => ({
    index,
    label: `D${index + 1}`,
    value,
    count: 1,
    time: [dayOne, dayTwo, dayThree][index] || null,
    activityType: null,
    rawItem: null
  }));

  it('should split a total bucket proportionally and preserve exact total', () => {
    const result = buildDashboardDateActivitySegmentation({
      rawData: [
        {
          time: dayOne,
          count: 2,
          [ChartDataValueTypes.Total]: 100,
          Hiking: 80,
          Climbing: 20,
          'Hiking-Count': 1,
          'Climbing-Count': 1
        }
      ],
      points: buildPoints([100]),
      chartDataValueType: ChartDataValueTypes.Total
    });

    expect(result.buckets).toHaveLength(1);
    expect(result.series.map((entry) => entry.key)).toEqual(['Hiking', 'Climbing']);
    expect(result.buckets[0].segments.map((segment) => segment.value)).toEqual([80, 20]);
    expect(result.buckets[0].segments.reduce((sum, segment) => sum + segment.value, 0)).toBe(100);
  });

  it('should normalize Average buckets using raw activity proportions', () => {
    const result = buildDashboardDateActivitySegmentation({
      rawData: [
        {
          time: dayOne,
          count: 2,
          [ChartDataValueTypes.Average]: 30,
          Hiking: 80,
          Climbing: 20
        }
      ],
      points: buildPoints([30]),
      chartDataValueType: ChartDataValueTypes.Average
    });

    expect(result.buckets[0].segments.map((segment) => segment.value)).toEqual([24, 6]);
    expect(result.buckets[0].segments.reduce((sum, segment) => sum + segment.value, 0)).toBe(30);
  });

  it('should normalize Minimum buckets using raw activity proportions', () => {
    const result = buildDashboardDateActivitySegmentation({
      rawData: [
        {
          time: dayOne,
          count: 2,
          [ChartDataValueTypes.Minimum]: 5,
          Hiking: 80,
          Climbing: 20
        }
      ],
      points: buildPoints([5]),
      chartDataValueType: ChartDataValueTypes.Minimum
    });

    expect(result.buckets[0].segments.map((segment) => segment.value)).toEqual([4, 1]);
    expect(result.buckets[0].segments.reduce((sum, segment) => sum + segment.value, 0)).toBe(5);
  });

  it('should normalize Maximum buckets using raw activity proportions', () => {
    const result = buildDashboardDateActivitySegmentation({
      rawData: [
        {
          time: dayOne,
          count: 2,
          [ChartDataValueTypes.Maximum]: 60,
          Hiking: 90,
          Climbing: 30
        }
      ],
      points: buildPoints([60]),
      chartDataValueType: ChartDataValueTypes.Maximum
    });

    expect(result.buckets[0].segments.map((segment) => segment.value)).toEqual([45, 15]);
    expect(result.buckets[0].segments.reduce((sum, segment) => sum + segment.value, 0)).toBe(60);
  });

  it('should create an Unknown segment when no activity contributions are present', () => {
    const result = buildDashboardDateActivitySegmentation({
      rawData: [
        {
          time: dayOne,
          count: 1,
          [ChartDataValueTypes.Total]: 10
        }
      ],
      points: buildPoints([10]),
      chartDataValueType: ChartDataValueTypes.Total
    });

    expect(result.series).toHaveLength(1);
    expect(result.series[0].label).toBe('Unknown');
    expect(result.buckets[0].segments[0].percent).toBe(100);
    expect(result.buckets[0].segments[0].value).toBe(10);
  });

  it('should produce empty segments for zero-total buckets', () => {
    const result = buildDashboardDateActivitySegmentation({
      rawData: [
        {
          time: dayOne,
          [ChartDataValueTypes.Total]: 0,
          Hiking: 80,
          Climbing: 20
        }
      ],
      points: buildPoints([0]),
      chartDataValueType: ChartDataValueTypes.Total
    });

    expect(result.buckets[0].segments).toEqual([]);
    expect(result.series).toEqual([]);
  });

  it('should align buckets to date points and keep missing days empty', () => {
    const result = buildDashboardDateActivitySegmentation({
      rawData: [
        {
          time: dayOne,
          [ChartDataValueTypes.Total]: 10,
          Hiking: 10
        },
        {
          time: dayThree,
          [ChartDataValueTypes.Total]: 30,
          Climbing: 30
        }
      ],
      points: buildPoints([10, 0, 30]),
      chartDataValueType: ChartDataValueTypes.Total
    });

    expect(result.buckets).toHaveLength(3);
    expect(result.buckets[1].time).toBe(dayTwo);
    expect(result.buckets[1].segments).toEqual([]);
    expect(result.series.map((entry) => entry.key)).toEqual(['Climbing', 'Hiking']);
  });
});
