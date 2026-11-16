import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { isAutomaticPushOrigin } from '../../../shared/web-push';
import { isRouteSendNotificationRequest, type SendRoutesToServiceRequest, type SendRoutesToServiceResponse } from '../../../shared/saved-route-send';
import { automaticPushConfiguration } from './history-consent';
import { beginRouteDeliveryNotification, completeRouteDeliveryNotification } from './route-delivery-service';
import type { RouteSendTicket } from './route-delivery-policy';
import type { ServiceNames } from '@sports-alliance/sports-lib';
import { createHash } from 'node:crypto';

async function configuration() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([automaticPushConfiguration('web_push_activity_delivery_enabled'), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Route notification configuration timed out.')), 5000);
  })]); } finally { if (timer) clearTimeout(timer); }
}
export async function beginManualRouteSendNotification(uid: string, payload: SendRoutesToServiceRequest,
  origin: unknown, impersonatedBy: unknown): Promise<RouteSendTicket | undefined> {
  if (impersonatedBy || typeof origin !== 'string' || !isAutomaticPushOrigin(origin)
    || !isRouteSendNotificationRequest(payload.notification, payload.routeIds.length)) return;
  try { return await beginRouteDeliveryNotification(uid, payload.destinationServiceName, payload.notification,
    payload.routeIds, payload.forceCopy === true, { db: getFirestore(), now: Date.now, configuration }); }
  catch { logger.error('[RouteDeliveryPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' }); return; }
}
export async function finishManualRouteSendNotification(ticket: RouteSendTicket | undefined, response: SendRoutesToServiceResponse, newlySent: number) {
  if (!ticket) return;
  try { await completeRouteDeliveryNotification(ticket, response, newlySent, { db: getFirestore(), now: Date.now }); }
  catch { logger.error('[RouteDeliveryPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' }); }
}

/** Only the four explicit file-upload callables use this wrapper; automatic route workers do not. */
export async function withManualRouteUploadNotification<T>(input: {
  uid: string; service: ServiceNames; origin: unknown; impersonatedBy: unknown; data: unknown;
}, send: () => Promise<T>): Promise<T> {
  const payload = input.data as { notification?: unknown; file?: unknown } | undefined;
  let ticket: RouteSendTicket | undefined;
  if (!input.impersonatedBy && typeof input.origin === 'string' && isAutomaticPushOrigin(input.origin)
    && typeof payload?.file === 'string' && isRouteSendNotificationRequest(payload.notification, 1, 1)
    && payload.notification.totalRoutes <= 400) {
    try { ticket = await beginRouteDeliveryNotification(input.uid, input.service, payload.notification,
      [createHash('sha256').update(payload.file).digest('hex')], false, { db: getFirestore(), now: Date.now, configuration }); }
    catch { logger.error('[RouteDeliveryPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' }); }
  }
  const finish = async (success: boolean) => finishManualRouteSendNotification(ticket, {
    destinationServiceName: input.service, status: success ? 'success' : 'failure', routeCount: 1,
    successCount: Number(success), failureCount: Number(!success), skippedCount: 0,
    results: [{ routeId: 'upload', destinationServiceName: input.service, status: success ? 'success' : 'failure' }],
  }, Number(success));
  try { const result = await send(); await finish(true); return result; }
  catch (error) { await finish(false); throw error; }
}
