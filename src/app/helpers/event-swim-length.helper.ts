import {
  ActivityInterface,
  DataCadence,
  DataDistance,
  DataDuration,
  DataEnergy,
  DataHeartRate,
  DataInterface,
  DataSpeed,
} from '@sports-alliance/sports-lib';

export interface AppSwimLength {
  index: number;
  lapIndex: number | null;
  startDate: Date;
  endDate: Date;
  type: string;
  stroke: string | null;
  strokes: number | null;
  elapsedTime: DataDuration | null;
  timerTime: DataDuration | null;
  distance: DataDistance | null;
  poolLength: DataDistance | null;
  avgSpeed: DataSpeed | null;
  avgCadence: DataCadence | null;
  avgHeartRate: DataHeartRate | null;
  maxHeartRate: DataHeartRate | null;
  swolf: number | null;
  calories: DataEnergy | null;
}

type ActivityWithSwimLengths = ActivityInterface & {
  getSwimLengths?: () => unknown;
};

function getRecordValue(record: Record<string, unknown>, key: keyof AppSwimLength): unknown {
  return record[key];
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isDataInterface(value: unknown): value is DataInterface {
  return !!value
    && typeof value === 'object'
    && typeof (value as DataInterface).getValue === 'function'
    && typeof (value as DataInterface).getDisplayValue === 'function'
    && typeof (value as DataInterface).getDisplayUnit === 'function';
}

function normalizeDataNumber<T extends DataInterface>(
  value: unknown,
  dataConstructor: new (value: number) => T,
): T | null {
  const rawValue = isDataInterface(value) ? value.getValue() : value;
  const numericValue = normalizeNumber(rawValue);
  return numericValue === null ? null : new dataConstructor(numericValue);
}

function normalizeString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function normalizeDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const timestamp = normalizeNumber(value);
  if (timestamp !== null) {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

export function normalizeSwimLength(value: unknown): AppSwimLength | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const index = normalizeNumber(getRecordValue(record, 'index'));
  const startDate = normalizeDate(getRecordValue(record, 'startDate'));
  const endDate = normalizeDate(getRecordValue(record, 'endDate'));
  const type = normalizeString(getRecordValue(record, 'type'));

  if (index === null || !startDate || !endDate || !type) {
    return null;
  }

  return {
    index,
    lapIndex: normalizeNumber(getRecordValue(record, 'lapIndex')),
    startDate,
    endDate,
    type,
    stroke: normalizeString(getRecordValue(record, 'stroke')),
    strokes: normalizeNumber(getRecordValue(record, 'strokes')),
    elapsedTime: normalizeDataNumber(getRecordValue(record, 'elapsedTime'), DataDuration),
    timerTime: normalizeDataNumber(getRecordValue(record, 'timerTime'), DataDuration),
    distance: normalizeDataNumber(getRecordValue(record, 'distance'), DataDistance),
    poolLength: normalizeDataNumber(getRecordValue(record, 'poolLength'), DataDistance),
    avgSpeed: normalizeDataNumber(getRecordValue(record, 'avgSpeed'), DataSpeed),
    avgCadence: normalizeDataNumber(getRecordValue(record, 'avgCadence'), DataCadence),
    avgHeartRate: normalizeDataNumber(getRecordValue(record, 'avgHeartRate'), DataHeartRate),
    maxHeartRate: normalizeDataNumber(getRecordValue(record, 'maxHeartRate'), DataHeartRate),
    swolf: normalizeNumber(getRecordValue(record, 'swolf')),
    calories: normalizeDataNumber(getRecordValue(record, 'calories'), DataEnergy),
  };
}

export function getActivitySwimLengths(activity: ActivityInterface | null | undefined): AppSwimLength[] {
  if (!activity) {
    return [];
  }

  const activityWithSwimLengths = activity as ActivityWithSwimLengths;
  const rawSwimLengths = typeof activityWithSwimLengths.getSwimLengths === 'function'
    ? activityWithSwimLengths.getSwimLengths()
    : [];

  if (!Array.isArray(rawSwimLengths)) {
    return [];
  }

  return rawSwimLengths
    .map(normalizeSwimLength)
    .filter((swimLength): swimLength is AppSwimLength => swimLength !== null);
}

export function hasVisibleSwimLengths(activities: ActivityInterface[] | null | undefined): boolean {
  return (activities || []).some(activity => getActivitySwimLengths(activity).length > 0);
}
