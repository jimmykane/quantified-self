import { ServiceNames } from '@sports-alliance/sports-lib';

export type HistoryResource = 'activities' | 'sleep' | 'health';
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
  startMs: number;
  endMs: number;
  updatedAtMs: number;
  active: boolean;
  canRetry: boolean;
  steps: ConnectionHistoryStepStatus[];
}
export function connectionHistoryRange(nowMs: number): { startMs: number; endMs: number } {
  if (!Number.isFinite(nowMs) || !Number.isFinite(new Date(nowMs).getTime())) throw new Error('Invalid connection time.');
  const date = new Date(nowMs);
  return { startMs: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 29), endMs: Math.floor(nowMs / 1000) * 1000 };
}
export function parseImportRecentHistory(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new Error('importRecentHistory must be a boolean.');
  return value;
}
