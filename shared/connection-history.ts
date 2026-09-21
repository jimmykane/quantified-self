import { ServiceNames } from '@sports-alliance/sports-lib';

export type HistoryResource = 'activities' | 'sleep' | 'health';
export const CONNECTION_HISTORY_DEFAULT_RANGE = '30_days' as const;
export type ConnectionHistoryRangePreset = '30_days' | '60_days' | '90_days' | '1_year' | '2_years' | 'maximum';
export interface ConnectionHistoryRangeOption {
  value: ConnectionHistoryRangePreset;
  label: string;
}
export interface HistoryCapability {
  id: string;
  version: number;
  resources: readonly HistoryResource[];
  cooldownGroup: 'activities' | 'sleep';
  completion: 'requested' | 'queued';
}
const activities: HistoryCapability = { id: 'activities', version: 1, resources: ['activities'], cooldownGroup: 'activities', completion: 'queued' };
const sleep: HistoryCapability = { id: 'sleep', version: 1, resources: ['sleep'], cooldownGroup: 'sleep', completion: 'queued' };
/** Shared presentation and orchestration inventory. New APIs register here once. */
export const CONNECTION_HISTORY_CAPABILITIES = {
  [ServiceNames.GarminAPI]: [{ ...activities, completion: 'requested' }, { ...sleep, completion: 'requested' }, { id: 'health', version: 1, resources: ['health'], cooldownGroup: 'sleep', completion: 'requested' }],
  [ServiceNames.SuuntoApp]: [activities, sleep, { id: 'health', version: 1, resources: ['health'], cooldownGroup: 'sleep', completion: 'queued' }],
  [ServiceNames.COROSAPI]: [activities, { id: 'daily', version: 1, resources: ['sleep', 'health'], cooldownGroup: 'sleep', completion: 'queued' }],
  [ServiceNames.WahooAPI]: [activities],
} as const satisfies Record<ServiceNames, readonly HistoryCapability[]>;
export type HistoryService = keyof typeof CONNECTION_HISTORY_CAPABILITIES;
export function historyCapabilities(service: ServiceNames): readonly HistoryCapability[] {
  return CONNECTION_HISTORY_CAPABILITIES[service as HistoryService] ?? [];
}
const standardRangeOptions: readonly ConnectionHistoryRangeOption[] = [
  { value: '30_days', label: '30 days' },
  { value: '90_days', label: '90 days' },
  { value: '1_year', label: '1 year' },
  { value: '2_years', label: '2 years' },
];
/** Provider range policy shared by the connection UI and server validation. */
export const CONNECTION_HISTORY_RANGE_OPTIONS = {
  [ServiceNames.GarminAPI]: [...standardRangeOptions, { value: 'maximum', label: 'Maximum available (5 years)' }],
  [ServiceNames.SuuntoApp]: [...standardRangeOptions, { value: 'maximum', label: 'All available history' }],
  [ServiceNames.COROSAPI]: [
    { value: '30_days', label: '30 days' },
    { value: '60_days', label: '60 days' },
    { value: 'maximum', label: 'Maximum available (3 months)' },
  ],
  [ServiceNames.WahooAPI]: [...standardRangeOptions, { value: 'maximum', label: 'All available history' }],
} as const satisfies Record<ServiceNames, readonly ConnectionHistoryRangeOption[]>;
export function historyRangeOptions(service: ServiceNames): readonly ConnectionHistoryRangeOption[] {
  return CONNECTION_HISTORY_RANGE_OPTIONS[service] ?? [];
}
export function historyRangeLabel(service: ServiceNames, preset: ConnectionHistoryRangePreset): string {
  return historyRangeOptions(service).find(option => option.value === preset)?.label ?? preset;
}
export type ConnectionHistoryStatus = 'queued' | 'requesting' | 'retrying' | 'requested' | 'processed' | 'skipped' | 'failed';
export interface ConnectionHistoryStepStatus {
  id: string;
  resources: readonly HistoryResource[];
  status: ConnectionHistoryStatus;
  count: number;
  message?: string;
  nextAllowedAtMs?: number;
}
export interface ConnectionHistoryStatusProjection {
  runId: string;
  rangePreset: ConnectionHistoryRangePreset;
  startMs: number;
  endMs: number;
  updatedAtMs: number;
  active: boolean;
  canRetry: boolean;
  steps: ConnectionHistoryStepStatus[];
}
function subtractUtcCalendarMonths(dayStart: Date, months: number): number {
  const absoluteMonth = dayStart.getUTCFullYear() * 12 + dayStart.getUTCMonth() - months;
  const year = Math.floor(absoluteMonth / 12);
  const month = absoluteMonth - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(dayStart.getUTCDate(), lastDay));
}
export function connectionHistoryRange(
  nowMs: number,
  service: ServiceNames = ServiceNames.GarminAPI,
  preset: ConnectionHistoryRangePreset = CONNECTION_HISTORY_DEFAULT_RANGE,
): { startMs: number; endMs: number } {
  if (!Number.isFinite(nowMs) || !Number.isFinite(new Date(nowMs).getTime())) throw new Error('Invalid connection time.');
  const date = new Date(nowMs);
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  let startMs: number;
  switch (preset) {
    case '30_days': startMs = dayStart.getTime() - 29 * 86_400_000; break;
    case '60_days': startMs = dayStart.getTime() - 59 * 86_400_000; break;
    case '90_days': startMs = dayStart.getTime() - 89 * 86_400_000; break;
    case '1_year': startMs = subtractUtcCalendarMonths(dayStart, 12); break;
    case '2_years': startMs = subtractUtcCalendarMonths(dayStart, 24); break;
    case 'maximum':
      if (service === ServiceNames.GarminAPI) startMs = subtractUtcCalendarMonths(dayStart, 60);
      else if (service === ServiceNames.COROSAPI) startMs = subtractUtcCalendarMonths(dayStart, 3);
      else if (service === ServiceNames.SuuntoApp) startMs = Date.UTC(2000, 0, 1);
      else startMs = 0;
      break;
  }
  return { startMs, endMs: Math.floor(nowMs / 1000) * 1000 };
}
export function parseImportRecentHistory(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new Error('importRecentHistory must be a boolean.');
  return value;
}
export function parseImportHistoryRange(value: unknown, service: ServiceNames): ConnectionHistoryRangePreset {
  if (value === undefined) return CONNECTION_HISTORY_DEFAULT_RANGE;
  if (typeof value !== 'string' || !historyRangeOptions(service).some(option => option.value === value)) {
    throw new Error(`importHistoryRange is not valid for ${service}.`);
  }
  return value as ConnectionHistoryRangePreset;
}
