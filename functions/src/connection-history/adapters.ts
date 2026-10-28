import * as admin from 'firebase-admin';
import { config } from '../config';
import { getServiceWorkoutQueueName } from '../shared/queue-names';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../sleep/constants';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { getSleepBackfillCooldownMs } from '../../../shared/sleep-backfill';
import { activityHistoryNextAllowedAt } from '../../../shared/history-import.constants';
import { addHistoryToQueue } from '../history';
import { processGarminBackfill, GarminHistoryRangeUnavailableError } from '../garmin/backfill';
import { importWahooHistory } from '../wahoo/history-to-queue';
import { queueSuuntoSleepHealthHistory, queueCorosSleepHealthHistory, queueGarminSleepHealthHistory } from '../sleep/backfill';
import { isGarminHealthSyncEnabled } from '../garmin/health-flags';
import { isSuuntoHealthSyncEnabled } from '../suunto/health-flags';
import { isSleepProviderEnabled, isSleepSyncUserAllowed } from '../sleep/provider-flags';
import { assertHistoryConnectionCurrent, HistoryUnavailableError, HistoryWindowTooLargeError, type HistoryExecution } from './execution';
import { queueSuuntoRouteHistory } from '../suunto/route-history';
import { ROUTE_SYNC_QUEUE_COLLECTION_NAME } from '../routes/route-sync.constants';
import { suuntoHistoryBatchRange } from '../suunto/history-windows';
import type { ConnectionHistoryRun, HistoryStep } from './model';

export class HistorySkippedError extends Error {
  constructor(message: string, public readonly nextAllowedAtMs?: number) { super(message); this.name = 'HistorySkippedError'; }
}
export function historySleepProvider(service: ServiceNames) {
  switch (service) {
    case ServiceNames.GarminAPI: return SLEEP_PROVIDERS.GarminAPI;
    case ServiceNames.SuuntoApp: return SLEEP_PROVIDERS.SuuntoApp;
    case ServiceNames.COROSAPI: return SLEEP_PROVIDERS.COROSAPI;
    default: throw new HistorySkippedError('This service does not provide Sleep or Health history.');
  }
}
export function historyCooldownUntil(service: ServiceNames, meta: Record<string, unknown> | undefined): number {
  return activityHistoryNextAllowedAt(Number(meta?.didLastHistoryImport), Number(meta?.processedActivitiesFromLastHistoryImportCount), service === ServiceNames.GarminAPI);
}
async function reserveActivities(run: ConnectionHistoryRun): Promise<void> {
  const db = admin.firestore();
  const ref = db.doc(`users/${run.userID}/meta/${run.serviceName}`);
  await db.runTransaction(async tx => {
    await assertHistoryConnectionCurrent(run, tx);
    const snapshot = await tx.get(ref); const meta = snapshot.data();
    if (meta?.connectionHistoryReservation === run.id) return;
    const next = historyCooldownUntil(run.serviceName, meta);
    if (next > Date.now()) throw new HistorySkippedError('History is in cooldown. You can use History Import after the date shown.', next);
    if (Number(meta?.historyImportLeaseExpiresAt) > Date.now()
      || Number(meta?.connectionHistoryReservationExpiresAt) > Date.now()) throw new HistorySkippedError('Another history import is already running.');
    tx.set(ref, { connectionHistoryReservation: run.id, connectionHistoryReservationExpiresAt: Date.now() + 7 * 86400000 }, { merge: true });
  });
}
export interface HistoryOperationResult { count: number; nextStartMs: number; nextPage: number; routeAfterId?: string; }
type HistoryOperation = (run: ConnectionHistoryRun, step: HistoryStep, execution: HistoryExecution) => Promise<HistoryOperationResult>;
export interface HistoryAdapter {
  execute: HistoryOperation;
  downstream: 'activities' | 'sleep' | 'garmin-health' | 'routes';
}
function historyWindow(run: ConnectionHistoryRun, step: HistoryStep) {
  // Manual dates retain millisecond precision; adjacent windows must not lose
  // the final second of a day. Existing automatic snapshots keep their cursor.
  const resolutionMs = run.rangePreset === 'custom' ? 1 : 1000;
  const endMs = Math.min(run.endMs, step.nextStartMs + (step.windowDays ?? 30) * 86400000 - resolutionMs);
  return { endMs, nextStartMs: endMs + resolutionMs };
}
export function getHistoryAdapter(run: ConnectionHistoryRun, step: HistoryStep): HistoryAdapter {
  if (step.suuntoWindowBatchVersion !== undefined && (step.suuntoWindowBatchVersion !== 1
    || run.serviceName !== ServiceNames.SuuntoApp || (step.id !== 'sleep' && step.id !== 'health')
    || step.resources.length !== 1 || step.resources[0] !== step.id)) {
    throw new HistorySkippedError('This history import plan changed. Reconnect to use the current version.');
  }
  const adapter = HISTORY_ADAPTERS[run.serviceName]?.[step.id]?.[step.capability.version];
  if (!adapter) throw new HistorySkippedError('This history capability changed. Reconnect to use the current version.');
  return adapter;
}
export function historyAdmissionQueue(run: ConnectionHistoryRun, step: HistoryStep): { taskQueue: string; collection: string } {
  const { downstream } = getHistoryAdapter(run, step);
  if (downstream === 'routes') return { taskQueue: config.cloudtasks.routeSyncQueue, collection: ROUTE_SYNC_QUEUE_COLLECTION_NAME };
  return downstream === 'activities'
    ? { taskQueue: config.cloudtasks.workoutQueue, collection: getServiceWorkoutQueueName(run.serviceName) }
    : { taskQueue: downstream === 'garmin-health' ? config.cloudtasks.garminHealthBackfillQueue : config.cloudtasks.sleepSyncQueue, collection: SLEEP_SYNC_QUEUE_COLLECTION_NAME };
}
export async function executeHistoryOperation(run: ConnectionHistoryRun, step: HistoryStep, execution: HistoryExecution): Promise<HistoryOperationResult> {
  const adapter = getHistoryAdapter(run, step);
  await execution.beforeRequest();
  return adapter.execute(run, step, execution);
}
async function executeActivityHistory(run: ConnectionHistoryRun, step: HistoryStep, execution: HistoryExecution): Promise<HistoryOperationResult> {
  const { endMs, nextStartMs } = historyWindow(run, step);
  await reserveActivities(run);
  if (run.serviceName === ServiceNames.GarminAPI) {
    try { await processGarminBackfill(run.userID, new Date(step.nextStartMs), new Date(endMs), execution); }
    catch (error) {
      if (error instanceof GarminHistoryRangeUnavailableError) {
        const resumeStartMs = Math.max(nextStartMs, error.minimumDate?.getTime() ?? nextStartMs);
        if (resumeStartMs <= run.endMs) return { count: 0, nextStartMs: resumeStartMs, nextPage: 1 };
        throw new HistorySkippedError(error.message);
      }
      throw error;
    }
    return { count: 1, nextStartMs, nextPage: 1 };
  }
  if (run.serviceName === ServiceNames.WahooAPI) {
    const result = await importWahooHistory(run.userID, new Date(run.startMs), new Date(run.endMs), { execution, singlePage: true, page: step.page, processedCountOffset: step.count });
    return { count: result.successCount, nextStartMs: result.nextPage ? run.startMs : run.endMs + 1000, nextPage: result.nextPage ?? 1 };
  }
  const result = await addHistoryToQueue(run.userID, run.serviceName, new Date(step.nextStartMs), new Date(endMs), {
    execution, maxItems: 100, expectedProviderUserId: run.providerUserId,
    cumulativeMetadata: { startDate: new Date(run.startMs), endDate: new Date(run.endMs), processedActivitiesCountOffset: step.count },
  });
  if (result.failureCount) throw new Error('Some activity admissions failed.');
  return { count: result.successCount, nextStartMs, nextPage: 1 };
}
async function executeSleepHealthHistory(run: ConnectionHistoryRun, step: HistoryStep, execution: HistoryExecution): Promise<HistoryOperationResult> {
  const batchedSuunto = run.serviceName === ServiceNames.SuuntoApp && step.suuntoWindowBatchVersion === 1
    && (step.id === 'sleep' || step.id === 'health');
  const { endMs, nextStartMs } = batchedSuunto
    ? suuntoHistoryBatchRange(step.nextStartMs, run.endMs, step.id as 'sleep' | 'health', step.windowDays)
    : historyWindow(run, step);
  const provider = historySleepProvider(run.serviceName);
  if (!isSleepProviderEnabled(provider) || !isSleepSyncUserAllowed(run.userID)) throw new HistorySkippedError('History sync is currently unavailable.');
  if (step.id === 'health' && ((run.serviceName === ServiceNames.GarminAPI && !isGarminHealthSyncEnabled())
    || (run.serviceName === ServiceNames.SuuntoApp && !isSuuntoHealthSyncEnabled()))) throw new HistorySkippedError('Health history is temporarily unavailable.');
  const state = await admin.firestore().doc(`users/${run.userID}/sleepSyncState/${provider}`).get();
  const nextAllowed = Number(state.data()?.nextBackfillAllowedAtMs || 0);
  if (state.data()?.connectionHistoryReservation !== run.id && nextAllowed > Date.now()) throw new HistorySkippedError('History is in cooldown. You can use History Import after the date shown.', nextAllowed);
  const options = { execution, startMs: step.nextStartMs, endMs, resources: step.resources,
    ...(batchedSuunto ? { suuntoWindowBatchVersion: 1 as const } : {}) };
  const operation = HISTORY_SLEEP_OPERATIONS[run.serviceName as keyof typeof HISTORY_SLEEP_OPERATIONS];
  if (!operation) throw new HistorySkippedError('History is not supported.');
  let result: Awaited<ReturnType<typeof operation>>;
  try { result = await operation(run.userID, options); }
  catch (error) {
    if (run.serviceName === ServiceNames.GarminAPI && error instanceof HistoryUnavailableError) {
      const resumeStartMs = Math.max(nextStartMs, error.earliestStartMs ?? nextStartMs);
      if (resumeStartMs <= run.endMs) return { count: 0, nextStartMs: resumeStartMs, nextPage: 1 };
    }
    throw error;
  }
  return { count: step.id === 'health' ? result.healthQueued ?? 0 : result.sleepQueued ?? result.queued, nextStartMs, nextPage: 1 };
}
async function executeRouteHistory(run: ConnectionHistoryRun, step: HistoryStep, execution: HistoryExecution): Promise<HistoryOperationResult> {
  const result = await queueSuuntoRouteHistory(run.userID, execution, step.routeAfterId, step.count);
  return { count: result.count, nextStartMs: result.hasMore ? run.startMs : run.endMs + 1000,
    nextPage: result.hasMore ? step.page + 1 : 1,
    ...(result.afterRouteId === undefined ? {} : { routeAfterId: result.afterRouteId }) };
}
const HISTORY_SLEEP_OPERATIONS = {
  [ServiceNames.GarminAPI]: queueGarminSleepHealthHistory,
  [ServiceNames.SuuntoApp]: queueSuuntoSleepHealthHistory,
  [ServiceNames.COROSAPI]: queueCorosSleepHealthHistory,
};
export function isHistoryWindowTooLarge(error: unknown): boolean {
  return error instanceof HistoryWindowTooLargeError || (error instanceof Error && error.name === 'ResponseBodyTooLargeError');
}
export function historySleepCooldown(run: ConnectionHistoryRun): number | null {
  return run.serviceName === ServiceNames.WahooAPI ? null : getSleepBackfillCooldownMs(historySleepProvider(run.serviceName));
}

/** Each advertised version must register executable work and its admission queue. */
export const HISTORY_ADAPTERS: Record<ServiceNames, Record<string, Record<number, HistoryAdapter>>> = {
  [ServiceNames.GarminAPI]: {
    activities: { 1: { execute: executeActivityHistory, downstream: 'activities' } },
    sleep: { 1: { execute: executeSleepHealthHistory, downstream: 'sleep' } },
    health: { 1: { execute: executeSleepHealthHistory, downstream: 'garmin-health' } },
  },
  [ServiceNames.SuuntoApp]: {
    routes: { 1: { execute: executeRouteHistory, downstream: 'routes' } },
    activities: { 1: { execute: executeActivityHistory, downstream: 'activities' } },
    sleep: { 1: { execute: executeSleepHealthHistory, downstream: 'sleep' } },
    health: { 1: { execute: executeSleepHealthHistory, downstream: 'sleep' } },
  },
  [ServiceNames.COROSAPI]: {
    activities: { 1: { execute: executeActivityHistory, downstream: 'activities' } },
    daily: { 1: { execute: executeSleepHealthHistory, downstream: 'sleep' } },
  },
  [ServiceNames.WahooAPI]: { activities: { 1: { execute: executeActivityHistory, downstream: 'activities' } } },
};
