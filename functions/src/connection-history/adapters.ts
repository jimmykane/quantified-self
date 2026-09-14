import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { getSleepBackfillCooldownMs } from '../../../shared/sleep-backfill';
import { activityHistoryNextAllowedAt } from '../../../shared/history-import.constants';
import { addHistoryToQueue } from '../history';
import { processGarminBackfill } from '../garmin/backfill';
import { importWahooHistory } from '../wahoo/history-to-queue';
import { queueSuuntoSleepHealthHistory, queueCorosSleepHealthHistory, queueGarminSleepHealthHistory } from '../sleep/backfill';
import { isGarminHealthSyncEnabled } from '../garmin/health-flags';
import { isSuuntoHealthSyncEnabled } from '../suunto/health-flags';
import { isSleepProviderEnabled, isSleepSyncUserAllowed } from '../sleep/provider-flags';
import { assertHistoryConnectionCurrent, HistoryWindowTooLargeError, type HistoryExecution } from './execution';
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
export interface HistoryOperationResult { count: number; nextStartMs: number; nextPage: number; }
export async function executeHistoryOperation(run: ConnectionHistoryRun, step: HistoryStep, execution: HistoryExecution): Promise<HistoryOperationResult> {
  if (!HISTORY_ADAPTER_VERSIONS[run.serviceName]?.[step.id]?.includes(step.capability.version)) throw new HistorySkippedError('This history capability changed. Reconnect to use the current version.');
  const endMs = Math.min(run.endMs, step.nextStartMs + (step.windowDays ?? 30) * 86400000 - 1000);
  const nextStartMs = endMs + 1000;
  await execution.beforeRequest();
  if (step.id === 'activities') {
    await reserveActivities(run);
    if (run.serviceName === ServiceNames.GarminAPI) {
      await processGarminBackfill(run.userID, new Date(step.nextStartMs), new Date(endMs), execution);
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
  const provider = historySleepProvider(run.serviceName);
  if (!isSleepProviderEnabled(provider) || !isSleepSyncUserAllowed(run.userID)) throw new HistorySkippedError('History sync is currently unavailable.');
  if (step.id === 'health' && ((run.serviceName === ServiceNames.GarminAPI && !isGarminHealthSyncEnabled())
    || (run.serviceName === ServiceNames.SuuntoApp && !isSuuntoHealthSyncEnabled()))) throw new HistorySkippedError('Health history is temporarily unavailable.');
  const state = await admin.firestore().doc(`users/${run.userID}/sleepSyncState/${provider}`).get();
  const nextAllowed = Number(state.data()?.nextBackfillAllowedAtMs || 0);
  if (state.data()?.connectionHistoryReservation !== run.id && nextAllowed > Date.now()) throw new HistorySkippedError('History is in cooldown. You can use History Import after the date shown.', nextAllowed);
  const options = { execution, startMs: step.nextStartMs, endMs, resources: step.resources };
  const operation = HISTORY_SLEEP_OPERATIONS[run.serviceName as keyof typeof HISTORY_SLEEP_OPERATIONS];
  if (!operation) throw new HistorySkippedError('History is not supported.');
  const result = await operation(run.userID, options);
  return { count: step.id === 'health' ? result.healthQueued ?? 0 : result.sleepQueued ?? result.queued, nextStartMs, nextPage: 1 };
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

/** Versions remain explicit so a removed/changed adapter cannot reinterpret an existing run. */
export const HISTORY_ADAPTER_VERSIONS: Record<ServiceNames, Record<string, readonly number[]>> = {
  [ServiceNames.GarminAPI]: { activities: [1], sleep: [1], health: [1] },
  [ServiceNames.SuuntoApp]: { activities: [1], sleep: [1], health: [1] },
  [ServiceNames.COROSAPI]: { activities: [1], daily: [1] },
  [ServiceNames.WahooAPI]: { activities: [1] },
};
