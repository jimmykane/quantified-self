import { SleepVitals } from '../../../shared/sleep';

export const MCP_SLEEP_VITAL_TYPES = [
  'averageHeartRateBpm',
  'minimumHeartRateBpm',
  'restingHeartRateBpm',
  'averageHrvMs',
  'hrvSampleCount',
  'overnightHrvMs',
  'maxSpo2Percent',
  'averageRespirationBrpm',
] as const satisfies readonly (keyof SleepVitals)[];

export type McpSleepVitalType = typeof MCP_SLEEP_VITAL_TYPES[number];

export type McpSleepVitalUnit =
  | 'beats_per_minute'
  | 'milliseconds'
  | 'count'
  | 'percent'
  | 'breaths_per_minute';

export interface McpSleepVitalDescriptor {
  type: McpSleepVitalType;
  label: string;
  unit: McpSleepVitalUnit;
}

/**
 * Public aggregate sleep-vital metadata. It deliberately contains no
 * provider-specific aliases, sample data, or source provenance.
 */
export const MCP_SLEEP_VITAL_DESCRIPTORS: readonly McpSleepVitalDescriptor[] = [
  {
    type: 'averageHeartRateBpm',
    label: 'Average heart rate',
    unit: 'beats_per_minute',
  },
  {
    type: 'minimumHeartRateBpm',
    label: 'Minimum heart rate',
    unit: 'beats_per_minute',
  },
  {
    type: 'restingHeartRateBpm',
    label: 'Resting heart rate',
    unit: 'beats_per_minute',
  },
  {
    type: 'averageHrvMs',
    label: 'Average HRV',
    unit: 'milliseconds',
  },
  {
    type: 'hrvSampleCount',
    label: 'HRV sample count',
    unit: 'count',
  },
  {
    type: 'overnightHrvMs',
    label: 'Overnight HRV',
    unit: 'milliseconds',
  },
  {
    type: 'maxSpo2Percent',
    label: 'Maximum blood oxygen saturation',
    unit: 'percent',
  },
  {
    type: 'averageRespirationBrpm',
    label: 'Average respiration',
    unit: 'breaths_per_minute',
  },
];
