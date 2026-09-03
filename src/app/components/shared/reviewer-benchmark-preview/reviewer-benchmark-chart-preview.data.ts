import { DataAltitude, DataHeartRate } from '@sports-alliance/sports-lib';
import type { EventChartPanelModel } from '../../../helpers/event-echarts-data.helper';
import { AppColors } from '../../../services/color/app.colors';

export const REVIEWER_BENCHMARK_DURATION_SECONDS = 3_995;

type BenchmarkDevice = {
  id: string;
  label: string;
  color: string;
  durationSeconds: number;
  heartRate: readonly number[];
  altitude: readonly number[];
};

// Whole-workout mean bins derived from an anonymized, read-only multi-device
// running benchmark. Product labels are representative public-facing examples.
const BENCHMARK_DEVICES: readonly BenchmarkDevice[] = [
  {
    id: 'suunto-vertical-2',
    label: 'Suunto Vertical 2',
    color: AppColors.Green,
    durationSeconds: 3_992,
    heartRate: [
      98.6, 121.6, 115.8, 59.9, 99.7, 121.2, 119.4, 120, 120.4, 134.2,
      138.6, 130, 129.6, 145.8, 136.8, 126.3, 142.7, 148.8, 128.8, 135,
      150.7, 139.4, 134, 148.8, 143.1, 121.9, 140.1, 155.1, 136.7, 133.1,
      151.9, 148.4, 133.9, 143.8, 153.5, 138, 138.3, 153.1, 147.1, 137.2,
      149.2, 156, 139.6, 144.2, 157.2, 144.1, 136.8, 151.8, 153.1, 138.5,
      136.1, 133.6, 134.3, 140, 136, 130.5, 127, 133.5, 134.2, 135.3, 132.9,
    ],
    altitude: [
      14.6, 14.5, 13.9, 7.1, 12.3, 13, 12.6, 12.3, 12.1, 12.2,
      12.1, 11.8, 11.4, 11.5, 11.1, 10.7, 10.5, 10.3, 10.5, 10.9,
      11.3, 11.6, 11.9, 11.2, 10.2, 9.4, 9.6, 9.5, 9.5, 10,
      10.9, 10.6, 10, 10.1, 10.2, 10.2, 10.6, 10.8, 10.6, 10.6,
      10.7, 10.6, 10.5, 10.9, 10.3, 9.5, 9.3, 9.6, 9, 8.6,
      8.8, 8.3, 8, 8.3, 8.7, 8.8, 8.7, 9.3, 9.8, 11.4, 11.4,
    ],
  },
  {
    id: 'coros-apex-4',
    label: 'COROS APEX 4',
    color: AppColors.Blue,
    durationSeconds: 3_987,
    heartRate: [
      98.8, 122.7, 116, 108.5, 106.8, 121.5, 121.9, 122, 121.3, 139.5,
      145.1, 130, 129.4, 140.7, 137.2, 126.5, 136.4, 148.3, 129.2, 134.2,
      151, 139.9, 134.2, 148.4, 145.6, 127.8, 141.1, 156.2, 137.6, 131.3,
      133, 136.2, 135.7, 139.1, 149.5, 138.3, 136.4, 135.8, 140.9, 137.3,
      142.9, 153.8, 140.8, 136.2, 139.5, 144.2, 136.4, 136, 140.8, 141.2,
      136.2, 134.4, 134.7, 140.2, 136.6, 135, 133.4, 133.5, 134.3, 134.8, 135.6,
    ],
    altitude: [
      13.8, 13.3, 12.6, 12, 12, 12, 11.1, 11, 11, 11,
      11, 11, 11, 11, 11, 11, 10.9, 10.5, 10.9, 11,
      11.7, 12, 12.6, 11.6, 11, 11, 10.6, 11, 11.1, 12,
      12, 11.8, 11.1, 11.5, 12, 11.4, 12, 11, 11, 11.2,
      11, 11, 11, 10.7, 10.4, 10.1, 10.2, 10.5, 10.9, 10.7,
      10.4, 10, 10, 10, 10.3, 10.3, 10.9, 11.1, 11, 12.1, 12.1,
    ],
  },
  {
    id: 'garmin-fenix-9',
    label: 'Garmin Fenix 9',
    color: AppColors.Orange,
    durationSeconds: 3_995,
    heartRate: [
      93.7, 122.9, 117.2, 112, 104.8, 120.8, 121.8, 121.3, 121.2, 136.4,
      146.1, 131.3, 128.7, 146.7, 140.8, 126.2, 142.1, 149.3, 131.2, 132.8,
      151.3, 142.2, 133.1, 148.6, 149.6, 130.9, 137.4, 155.8, 139.7, 132.8,
      151.3, 151.1, 134.2, 140.1, 151.9, 139.2, 137.7, 152, 148.4, 136.8,
      146.5, 152.8, 139.6, 140.3, 147.6, 144.3, 135.4, 148.9, 153.2, 139,
      135.4, 133.6, 133.9, 140.1, 136.4, 135.3, 132.4, 134.5, 134.3, 135.2, 130.9,
    ],
    altitude: [
      11.9, 11.8, 11.2, 11.2, 11.2, 11.3, 11.3, 11.4, 11.3, 11.9,
      11.7, 11.3, 11, 11.4, 11.3, 11.1, 11.3, 11.4, 11.4, 11.7,
      12.7, 13.2, 13, 12.2, 11.7, 10.4, 9.5, 10, 10.3, 10.8,
      11.2, 11.1, 10.8, 11.1, 11.3, 11.4, 11.7, 12.3, 12.9, 12.7,
      12.1, 11.5, 11.1, 11, 11.5, 11.6, 11.8, 12.1, 11.9, 11,
      10.5, 10.3, 10.3, 9.6, 9, 8.9, 8.6, 8.9, 9.6, 11.2, 12.5,
    ],
  },
];

function buildPanel(
  dataType: string,
  displayName: string,
  unit: string,
  valuesForDevice: (device: BenchmarkDevice) => readonly number[],
): EventChartPanelModel {
  return {
    dataType,
    displayName,
    unit,
    colorGroupKey: displayName,
    minX: 0,
    maxX: REVIEWER_BENCHMARK_DURATION_SECONDS,
    series: BENCHMARK_DEVICES.map((device) => {
      const values = valuesForDevice(device);
      const finalIndex = Math.max(1, values.length - 1);

      return {
        id: `reviewer-benchmark::${device.id}::${dataType}`,
        activityID: `reviewer-benchmark::${device.id}`,
        activityName: device.label,
        color: device.color,
        streamType: dataType,
        displayName,
        unit,
        points: values.map((value, index) => {
          const x = Math.round((index / finalIndex) * device.durationSeconds);
          return { x, y: value, time: x };
        }),
      };
    }),
  };
}

export const REVIEWER_BENCHMARK_HEART_RATE_PANEL = buildPanel(
  DataHeartRate.type,
  'Heart Rate',
  'bpm',
  (device) => device.heartRate,
);

export const REVIEWER_BENCHMARK_ALTITUDE_PANEL = buildPanel(
  DataAltitude.type,
  'Altitude',
  'm',
  (device) => device.altitude,
);
