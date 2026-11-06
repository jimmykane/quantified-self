import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { currentHistoryExecution } from '../connection-history/context';
import { CONNECTION_HISTORY_COLLECTION, type ConnectionHistoryRun } from '../connection-history/model';
import type { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import type { GarminHealthSummaryType } from './health-summary-types';

// A long pause must recheck availability, including retries of the same run.
export const GARMIN_HEALTH_BACKFILL_CUTOFF_MAX_AGE_MS = 60 * 60 * 1_000;
type Cutoffs = ConnectionHistoryRun['garminHealthBackfillCutoffs'];

/** Permission callbacks do not rotate OAuth generations; retain their own authority. */
export function garminHealthPermissionsRevision(tokenData: Record<string, unknown>): string | null {
  const permissions = tokenData.permissions;
  if (permissions != null && (!Array.isArray(permissions) || permissions.some(value => typeof value !== 'string'))) return null;
  const changedAt = tokenData.permissionsLastChangedAt;
  if (changedAt != null && ((typeof changedAt !== 'number' && typeof changedAt !== 'string')
    || (typeof changedAt === 'string' && !changedAt.trim()) || !Number.isFinite(Number(changedAt)) || Number(changedAt) < 0)) return null;
  return createHash('sha256').update(JSON.stringify([
    permissions == null ? null : [...new Set(permissions as string[])].sort(),
    changedAt == null ? null : Number(changedAt),
  ])).digest('hex');
}

function isFreshCutoff(
  cutoff: NonNullable<Cutoffs>[GarminHealthSummaryType],
  permissionsRevision: string | null,
  nowMs: number,
): boolean {
  return !!cutoff && Number.isSafeInteger(cutoff.minimumStartMs) && cutoff.minimumStartMs >= 0
    && Number.isSafeInteger(cutoff.observedAtMs) && cutoff.observedAtMs >= 0 && cutoff.minimumStartMs <= cutoff.observedAtMs
    && cutoff.observedAtMs <= nowMs && nowMs - cutoff.observedAtMs < GARMIN_HEALTH_BACKFILL_CUTOFF_MAX_AGE_MS
    && typeof cutoff.permissionsRevision === 'string' && /^[0-9a-f]{64}$/.test(cutoff.permissionsRevision)
    && cutoff.permissionsRevision === permissionsRevision;
}

export function knownUnavailableGarminHealthMinimum(
  cutoffs: Cutoffs,
  family: GarminHealthSummaryType,
  rangeEndMs: number,
  permissionsRevision: string | null,
  nowMs = Date.now(),
): number | null {
  const cutoff = cutoffs?.[family];
  // Equality retains the inclusive final second; overlapping ranges still ask Garmin.
  if (!cutoff || !isFreshCutoff(cutoff, permissionsRevision, nowMs) || rangeEndMs >= cutoff.minimumStartMs) return null;
  return cutoff.minimumStartMs;
}

function matchesExecution(item: SleepSyncQueueItemInterface): boolean {
  const execution = currentHistoryExecution();
  return !!execution && !!item.connectionHistoryRunId && execution.runId === item.connectionHistoryRunId
    && execution.userID === item.userID && execution.serviceName === ServiceNames.GarminAPI
    && execution.providerUserId === item.providerUserId;
}

export function currentUnavailableGarminHealthMinimum(
  item: SleepSyncQueueItemInterface, family: GarminHealthSummaryType, permissionsRevision: string | null,
): number | null {
  return matchesExecution(item)
    ? knownUnavailableGarminHealthMinimum(currentHistoryExecution()?.garminHealthBackfillCutoffs, family, item.rangeEndMs!, permissionsRevision)
    : null;
}

/** Read before any writes, inside the existing cursor/lifecycle transaction. */
export async function readGarminHealthCutoffRun(transaction: admin.firestore.Transaction, item: SleepSyncQueueItemInterface) {
  if (!matchesExecution(item)) return null;
  const execution = currentHistoryExecution()!;
  const ref = admin.firestore().collection(CONNECTION_HISTORY_COLLECTION).doc(execution.runId);
  const run = (await transaction.get(ref)).data() as ConnectionHistoryRun | undefined;
  if (!run || run.processed || run.id !== execution.runId || run.userID !== item.userID
    || run.serviceName !== ServiceNames.GarminAPI || run.providerUserId !== item.providerUserId
    || run.tokenPath !== execution.tokenPath
    || run.credentialGeneration !== item.garminHealthTokenCredentialGeneration
    || run.credentialGeneration !== item.garminHealthRootOAuthCredentialGeneration
    || run.connectionGeneration !== item.garminHealthConnectionStateGeneration
    || item.rangeStartMs! < run.startMs || item.rangeEndMs! > run.endMs) return null;
  return { ref, cutoffs: run.garminHealthBackfillCutoffs };
}

/** Only invoked for a parsed HTTP 400 minimum after the exact queue cursor was fenced. */
export function rememberGarminHealthMinimum(
  transaction: admin.firestore.Transaction,
  run: NonNullable<Awaited<ReturnType<typeof readGarminHealthCutoffRun>>>,
  family: GarminHealthSummaryType,
  minimumStartMs: number,
  permissionsRevision: string | null,
  currentPermissionsRevision: string | null,
  observedAtMs: number,
): void {
  const nowMs = Date.now();
  const cutoff = { minimumStartMs, observedAtMs, permissionsRevision: permissionsRevision ?? undefined };
  if (!isFreshCutoff(cutoff, currentPermissionsRevision, nowMs)) return;
  const previous = run.cutoffs?.[family];
  if (previous && isFreshCutoff(previous, currentPermissionsRevision, nowMs)
    && (previous.observedAtMs > observedAtMs
      // Simultaneous observations prefer the boundary that requests more history.
      || (previous.observedAtMs === observedAtMs && previous.minimumStartMs <= minimumStartMs))) return;
  // Use the latest response, including a lower minimum if Garmin expands availability.
  transaction.update(run.ref, { [`garminHealthBackfillCutoffs.${family}`]: cutoff });
}
