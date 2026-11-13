'use strict';

import { readHistoryNotificationConsent } from '../web-push/history-consent';

import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { hasProAccess, PRO_REQUIRED_MESSAGE, enforceAppCheck } from '../utils';
import { SERVICE_NAME } from './constants';
import { HistoryImportResult, addHistoryToQueue, getNextAllowedHistoryImportDate } from '../history';
import { HistoryImportAdmissionError, HistoryLifecycleChangedError } from '../connection-history/execution';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS } from '../utils';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import type { ConnectionHistoryStatusProjection } from '../../../shared/connection-history';

interface HistoryToQueueRequest {
  startDate: string;
  endDate: string;
  background?: boolean;
  notification?: unknown;
}

interface HistoryToQueueResponse {
  result: string;
  stats?: HistoryImportResult;
  historyImport?: ConnectionHistoryStatusProjection;
}

interface HistoryRequestDiagnostics {
  failureStage: 'app_check' | 'authentication' | 'subscription' | 'request_validation' | 'notification_consent'
    | 'background_admission' | 'legacy_cooldown' | 'legacy_import';
  mode: 'unknown' | 'background' | 'legacy' | 'invalid';
  notificationRequested: boolean;
}

/** Match only our fixed rejection messages; never emit dates, identities, request data or raw errors. */
function historyRequestRejectionReason(error: unknown): string {
  if (!(error instanceof HttpsError)) return 'unexpected_error';
  const reasons: Record<string, string> = {
    'User must be authenticated.': 'authentication_required',
    [PRO_REQUIRED_MESSAGE]: 'subscription_required',
    'background must be a boolean.': 'invalid_background',
    'No start and/or end date': 'invalid_dates',
    'Start date is after the end date': 'reversed_dates',
    'Notifications require a background import.': 'notification_requires_background',
    'Import notifications require your own account on a supported QS site.': 'notification_consent_not_allowed',
    'Choose a registered notification device.': 'invalid_notification_target',
    'Unsupported import notification.': 'unsupported_notification',
    'Import notifications are unavailable. Import without a notification or try again later.': 'notifications_unavailable',
    'History-import notifications are off. Enable the category in Settings or import without a notification.': 'notifications_disabled',
    'Enable notifications on this device again, or import without a notification.': 'notification_registration_changed',
    'Reconnect before importing history.': 'connection_unavailable',
    'Account is being deleted or no longer exists.': 'account_unavailable',
    'Connection changed. Please retry the history request.': 'connection_changed',
    'History import is no longer active. Please retry.': 'history_superseded',
  };
  if (Object.prototype.hasOwnProperty.call(reasons, error.message)) return reasons[error.message];
  if (error.code === 'permission-denied' && error.message.startsWith('History import is not allowed until ')) return 'cooldown_active';
  return error.code === 'already-exists' ? 'import_already_running' : 'unclassified';
}

/**
 * Add to the workout queue the workouts of a user for a selected date range
 */
export const addSuuntoAppHistoryToQueue = onCall({
  region: FUNCTIONS_MANIFEST.addSuuntoAppHistoryToQueue.region,
  secrets: FUNCTION_SECRET_BINDINGS.addSuuntoAppHistoryToQueue,
  cors: ALLOWED_CORS_ORIGINS,
  memory: '512MiB',
  maxInstances: 10
}, async (request): Promise<HistoryToQueueResponse> => {
  const diagnostics: HistoryRequestDiagnostics = { failureStage: 'app_check', mode: 'unknown', notificationRequested: false };
  const startedAtMs = Date.now();
  try {
    return await handleHistoryRequest(request, diagnostics);
  } catch (error) {
    const expected = error instanceof HttpsError && error.httpErrorCode.status < 500;
    logger[expected ? 'warn' : 'error']('[SuuntoHistoryImport] Request failed.', {
      ...diagnostics,
      errorCode: error instanceof HttpsError ? error.code : 'internal',
      reason: historyRequestRejectionReason(error),
      elapsedMs: Math.max(0, Date.now() - startedAtMs),
    });
    throw error;
  }
});

async function handleHistoryRequest(
  request: CallableRequest<HistoryToQueueRequest>, diagnostics: HistoryRequestDiagnostics,
): Promise<HistoryToQueueResponse> {
  // App Check verification
  enforceAppCheck(request);

  // Auth verification
  diagnostics.failureStage = 'authentication';
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const userID = request.auth.uid;

  // Enforce Pro Access
  diagnostics.failureStage = 'subscription';
  if (!(await hasProAccess(userID))) {
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }

  diagnostics.failureStage = 'request_validation';
  const { startDate: startDateStr, endDate: endDateStr, background, notification: notificationValue } = (request.data ?? {}) as HistoryToQueueRequest;
  diagnostics.mode = background === true ? 'background' : background === false || background === undefined ? 'legacy' : 'invalid';
  diagnostics.notificationRequested = notificationValue !== undefined;
  if (background !== undefined && typeof background !== 'boolean') throw new HttpsError('invalid-argument', 'background must be a boolean.');
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  if (!startDate || isNaN(startDate.getTime()) || !endDate || isNaN(endDate.getTime())) {
    throw new HttpsError('invalid-argument', 'No start and/or end date');
  }

  if (startDate > endDate) {
    throw new HttpsError('invalid-argument', 'Start date is after the end date');
  }

  diagnostics.failureStage = 'notification_consent';
  const notification = readHistoryNotificationConsent(notificationValue, request.rawRequest?.get?.('origin'), request.auth.token?.impersonatedBy);
  if (notification && background !== true) throw new HttpsError('invalid-argument', 'Notifications require a background import.');
  if (background === true) {
    diagnostics.failureStage = 'background_admission';
    const { startManualActivityHistory } = await import('../connection-history/manual-activity');
    const historyImport = await startManualActivityHistory(userID, SERVICE_NAME, startDate, endDate, ...(notification ? [notification] as const : [] as const));
    return { result: 'History import accepted', historyImport };
  }

  // First check last history import
  diagnostics.failureStage = 'legacy_cooldown';
  const nextAllowedDate = await getNextAllowedHistoryImportDate(userID, SERVICE_NAME);
  if (nextAllowedDate && nextAllowedDate > new Date()) {
    throw new HttpsError('permission-denied', `History import is not allowed until ${nextAllowedDate.toISOString()}`);
  }

  diagnostics.failureStage = 'legacy_import';
  let stats: HistoryImportResult;
  try {
    stats = await addHistoryToQueue(userID, SERVICE_NAME, startDate, endDate);

    if (stats.successCount === 0 && stats.failureCount > 0) {
      throw new Error(`Failed to import all ${stats.failureCount} items.`);
    }

    if (stats.failureCount > 0) {
      logger.warn(`Partial import success: ${stats.successCount} imported, ${stats.failureCount} failed.`);
    }
  } catch (e: any) {
    if (e instanceof HistoryImportAdmissionError) {
      logger.info('[SuuntoHistoryImport] History admission was blocked.', { code: e.code });
      throw e;
    }
    if (e instanceof HistoryLifecycleChangedError) {
      logger.info('[SuuntoHistoryImport] History import is no longer active.');
      throw new HttpsError('failed-precondition', 'History import is no longer active. Please retry.');
    }
    if (e instanceof HttpsError && e.code === 'already-exists') {
      logger.info('[SuuntoHistoryImport] History import is already running.');
      throw e;
    }
    throw new HttpsError('internal', e.message);
  }

  return { result: 'History items added to queue', stats };
}
