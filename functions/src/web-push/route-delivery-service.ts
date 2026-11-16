import { randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { RouteSendNotificationRequest, SendRoutesToServiceResponse } from '../../../shared/saved-route-send';
import { TERMINAL_IN_BAND_ROUTE_SEND_REASONS } from '../../../shared/saved-route-send';
import { notificationPreferencePath, readNotificationCategoryPreference } from '../../../shared/notification-categories';
import { isAutomaticPushOrigin, isPushId, isPushRegistration, WEB_PUSH_ORIGINS } from '../../../shared/web-push';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import type { ActivityPushDependencies } from './activity-service';
import { ROUTE_PUSH, ROUTE_PUSH_SERVICES, isRoutePushService, routeDeliveryPayload, routeSendCounts, routeSendHash, routeSendStatePath,
  sameRouteSend, type RouteSendResult, type RouteSendTicket } from './route-delivery-policy';

interface State { pending: RouteSendResult[]; seen: { id: string; expiresAt: number; claimId?: string }[]; dueAt?: number; }
type AdmissionDependencies = Pick<ActivityPushDependencies, 'db' | 'now' | 'configuration'>;
function readState(value: State | undefined, now: number): State {
  if (!value) return { pending: [], seen: [] };
  if (!Array.isArray(value.pending) || value.pending.length > ROUTE_PUSH.pendingLimit || !Array.isArray(value.seen)
    || value.seen.length > ROUTE_PUSH.seenLimit || value.seen.some(row => !isPushId(row.id) || !Number.isSafeInteger(row.expiresAt))
    || value.pending.some(row => !isPushId(row.id) || !isRoutePushService(row.service) || !Number.isSafeInteger(row.total)
      || row.total < 1 || row.total > 10000 || !Number.isSafeInteger(row.createdAt) || !Number.isSafeInteger(row.touchedAt)
      || !row.chunks || Object.keys(row.chunks).length > 400 || !Array.isArray(row.targets) || row.targets.length > ROUTE_PUSH.deviceLimit)) {
    throw new Error('Invalid route notification state.');
  }
  return { ...value, seen: value.seen.filter(row => row.expiresAt > now) };
}
function writeState(db: Firestore, tx: Transaction, uid: string, state: State) {
  const due = state.pending.map(row => Math.min(row.createdAt + ROUTE_PUSH.lifetimeMs, row.readyAt ?? row.touchedAt + ROUTE_PUSH.idleMs));
  tx.set(db.doc(routeSendStatePath(uid)), { pending: state.pending, seen: state.seen, ...(due.length ? { dueAt: Math.min(...due) } : {}) });
}
async function liveConnection(db: Firestore, tx: Transaction, uid: string, request: RouteSendResult) {
  const [metaDoc, epochDoc] = await tx.getAll(db.doc(`users/${uid}/meta/${request.service}`), db.doc(`users/${uid}/trainingDeliveryState/current`),
    { fieldMask: ['providerUserId', 'activityNotificationConnectedAtMs', 'connectionState', 'connectionStateGeneration',
      'reconnectNotificationId', 'reconnectNotificationStartedAtMs', `connectionEpochs.${ROUTE_PUSH_SERVICES[request.service].toLowerCase()}`] });
  const meta = metaDoc.data() ?? {};
  if ((epochDoc.get(`connectionEpochs.${ROUTE_PUSH_SERVICES[request.service].toLowerCase()}`) ?? 0) !== request.epoch
    || request.account !== null && meta.providerUserId !== request.account
    || (meta.activityNotificationConnectedAtMs ?? 0) !== request.connectedAt) return false;
  // Legacy connections can lack a metadata pin/generation; explicit outcomes remain eligible without reading credentials.
  if (meta.connectionState == null || meta.connectionState === 'connected') return (meta.connectionStateGeneration || null) === request.generation;
  return meta.connectionState === 'reconnect_required' && isPushId(meta.reconnectNotificationId)
    && (meta.reconnectNotificationId === request.episode || Number(meta.reconnectNotificationStartedAtMs) >= request.createdAt);
}

/** Captures device/category consent once for an explicit saved-route action, including its later 25-route chunks. */
export async function beginRouteDeliveryNotification(uid: string, service: string, notification: RouteSendNotificationRequest,
  routeIds: readonly string[], forceCopy: boolean, deps: AdmissionDependencies): Promise<RouteSendTicket | undefined> {
  if (!isRoutePushService(service)) return;
  const config = await deps.configuration(); if (!config.enabled) return;
  const { db } = deps, hash = routeSendHash(routeIds, forceCopy);
  return db.runTransaction(async tx => {
    const now = deps.now();
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid, now)).shouldSkip) return;
    const ref = db.doc(routeSendStatePath(uid));
    const state = readState((await tx.get(ref)).data() as State | undefined, now);
    if (state.seen.some(row => row.id === notification.requestId)) return;
    let request = state.pending.find(row => row.id === notification.requestId);
    const preference = readNotificationCategoryPreference((await tx.get(db.doc(notificationPreferencePath(uid, 'route_delivery')))).data());
    if (!preference?.enabled) return;
    if (!request) {
      // Only the first chunk can establish consent. Old network replays cannot become new notifications after receipt expiry.
      if (notification.chunkIndex !== 0 || Math.abs(now - notification.createdAtMs) > ROUTE_PUSH.clockSkewMs
        || state.pending.length >= ROUTE_PUSH.pendingLimit || state.seen.length + state.pending.length >= ROUTE_PUSH.seenLimit) return;
      const [metaDoc, devices, epochDoc] = await Promise.all([
        tx.get(db.doc(`users/${uid}/meta/${service}`)),
        tx.get(db.collection(`users/${uid}/pushSubscriptions`).where('origin', 'in', [...WEB_PUSH_ORIGINS]).limit(ROUTE_PUSH.deviceLimit)),
        tx.get(db.doc(`users/${uid}/trainingDeliveryState/current`)),
      ]);
      const meta = metaDoc.data() ?? {}, epoch = epochDoc.get(`connectionEpochs.${ROUTE_PUSH_SERVICES[service].toLowerCase()}`) ?? 0;
      if (!['connected', 'reconnect_required', undefined, null].includes(meta.connectionState)
        || meta.providerUserId != null && typeof meta.providerUserId !== 'string'
        || meta.connectionStateGeneration != null && typeof meta.connectionStateGeneration !== 'string'
        || !Number.isSafeInteger(meta.activityNotificationConnectedAtMs ?? 0) || !Number.isSafeInteger(epoch) || epoch < 0) return;
      const targets = devices.docs.flatMap(doc => {
        const registration = doc.data();
        return isPushId(doc.id) && isPushRegistration(registration) && isAutomaticPushOrigin(registration.origin)
          && registration.vapidPublicKey === config.publicKey
          ? [{ id: doc.id, generation: registration.generation, origin: registration.origin }] : [];
      });
      if (!targets.length) return;
      request = { id: notification.requestId, clientCreatedAt: notification.createdAtMs, createdAt: now, touchedAt: now,
        total: notification.totalRoutes, service, forceCopy, categoryRevision: preference.revision, account: meta.providerUserId || null,
        connectedAt: meta.activityNotificationConnectedAtMs ?? 0, generation: meta.connectionStateGeneration || null, epoch,
        ...(isPushId(meta.reconnectNotificationId) ? { episode: meta.reconnectNotificationId } : {}), targets, chunks: {} };
      state.pending.push(request);
    }
    if (!sameRouteSend(request, notification, service, forceCopy) || request.closed || request.readyAt !== undefined
      || request.categoryRevision !== preference.revision || now > request.createdAt + ROUTE_PUSH.lifetimeMs
      || request.chunks[notification.chunkIndex]
      || Object.values(request.chunks).reduce((total, chunk) => total + chunk.count, 0) + routeIds.length > request.total) return;
    request.chunks[notification.chunkIndex] = { hash, count: routeIds.length, finished: false, sent: 0, attention: 0 };
    request.touchedAt = now; writeState(db, tx, uid, state);
    return { uid, id: request.id, index: notification.chunkIndex, hash };
  });
}

/** Counts only server-produced outcomes. Notifications cannot change provider retries or accepted-route receipts. */
export async function completeRouteDeliveryNotification(ticket: RouteSendTicket, response: SendRoutesToServiceResponse,
  newlySent: number, deps: Pick<AdmissionDependencies, 'db' | 'now'>): Promise<void> {
  const { db } = deps;
  await db.runTransaction(async tx => {
    const now = deps.now();
    if ((await getUserDeletionGuardStateInTransaction(db, tx, ticket.uid, now)).shouldSkip) return;
    const state = readState((await tx.get(db.doc(routeSendStatePath(ticket.uid)))).data() as State | undefined, now);
    const request = state.pending.find(row => row.id === ticket.id), chunk = request?.chunks[ticket.index];
    if (!request || !chunk || chunk.finished || chunk.hash !== ticket.hash || request.closed || request.service !== response.destinationServiceName
      || chunk.count !== response.results.length || !Number.isSafeInteger(newlySent) || newlySent < 0
      || newlySent > response.results.filter(row => row.status === 'success').length || now > request.createdAt + ROUTE_PUSH.lifetimeMs) return;
    chunk.finished = true; chunk.sent = newlySent;
    chunk.attention = response.results.filter(row => row.status !== 'success').length;
    request.touchedAt = now;
    const counts = routeSendCounts(request);
    request.closed = response.results.some(row => row.reason && TERMINAL_IN_BAND_ROUTE_SEND_REASONS.includes(row.reason))
      || counts.completed === request.total;
    if (request.closed) request.readyAt = now;
    writeState(db, tx, ticket.uid, state);
  });
}

/** Shares the existing indexed minute sweep. One request is claimed per account/sweep, before any transport. */
export async function sendRouteDeliveryNotification(uid: string, deps: ActivityPushDependencies): Promise<void> {
  const { db } = deps, config = await deps.configuration(), ref = db.doc(routeSendStatePath(uid));
  const claim = await db.runTransaction(async tx => {
    const now = deps.now();
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid, now)).shouldSkip) {
      if ((await tx.get(ref)).exists) tx.delete(ref);
      return null;
    }
    const state = readState((await tx.get(ref)).data() as State | undefined, now);
    const request = state.pending.find(row => Math.min(row.createdAt + ROUTE_PUSH.lifetimeMs, row.readyAt ?? row.touchedAt + ROUTE_PUSH.idleMs) <= now);
    if (!request) return null;
    const preference = readNotificationCategoryPreference((await tx.get(db.doc(notificationPreferencePath(uid, 'route_delivery')))).data());
    const live = config.enabled && preference?.enabled && preference.revision === request.categoryRevision
      && now <= request.createdAt + ROUTE_PUSH.lifetimeMs && (request.readyAt === undefined || now <= request.readyAt + ROUTE_PUSH.expiryMs)
      && await liveConnection(db, tx, uid, request);
    const counts = routeSendCounts(request), attention = counts.attention + request.total - counts.completed;
    const claimId = randomUUID(); state.pending = state.pending.filter(row => row.id !== request.id);
    state.seen.push({ id: request.id, expiresAt: now + ROUTE_PUSH.lifetimeMs, claimId });
    // Bound retained receipts even when many requests complete together.
    state.seen = state.seen.slice(-ROUTE_PUSH.seenLimit); writeState(db, tx, uid, state);
    return { request, claimId, sent: counts.sent, attention, live: live && counts.sent + attention > 0 };
  });
  if (!claim) return;
  if (!claim.live) { deps.outcome('cancelled'); return; }
  const endpoints = new Set<string>(); let preparationFailed = false;
  for (let offset = 0; offset < claim.request.targets.length; offset += 5) {
    const results = await Promise.allSettled(claim.request.targets.slice(offset, offset + 5).map(async target => {
      const deviceRef = db.doc(`users/${uid}/pushSubscriptions/${target.id}`);
      const ready = await db.runTransaction(async tx => {
        const now = deps.now();
        if ((await getUserDeletionGuardStateInTransaction(db, tx, uid, now)).shouldSkip) return null;
        const [snapshot, pref, device] = await Promise.all([tx.get(ref), tx.get(db.doc(notificationPreferencePath(uid, 'route_delivery'))), tx.get(deviceRef)]);
        const preference = readNotificationCategoryPreference(pref.data()), registration = device.data();
        if (!preference?.enabled || preference.revision !== claim.request.categoryRevision
          || !(snapshot.get('seen') as State['seen'] | undefined)?.some(row => row.id === claim.request.id && row.claimId === claim.claimId)
          || now > claim.request.createdAt + ROUTE_PUSH.lifetimeMs
          || claim.request.readyAt !== undefined && now > claim.request.readyAt + ROUTE_PUSH.expiryMs
          || !isPushRegistration(registration) || !isAutomaticPushOrigin(registration.origin) || registration.origin !== target.origin
          || registration.generation !== target.generation || registration.vapidPublicKey !== config.publicKey
          || !await liveConnection(db, tx, uid, claim.request)) return null;
        return registration;
      });
      if (!ready || endpoints.has(ready.endpoint)) { deps.outcome('cancelled'); return; }
      endpoints.add(ready.endpoint);
      let outcome: 'accepted' | 'expired' | 'failed';
      try { await deps.send(ready, JSON.stringify(routeDeliveryPayload(ready.origin, claim.request, claim.sent, claim.attention))); outcome = 'accepted'; }
      catch (error) { const status = (error as { statusCode?: unknown } | null)?.statusCode; outcome = status === 404 || status === 410 ? 'expired' : 'failed'; }
      deps.outcome(outcome);
      if (outcome === 'expired') await db.runTransaction(async tx => {
        if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return;
        if ((await tx.get(deviceRef)).get('generation') === target.generation) tx.delete(deviceRef);
      });
    }));
    if (results.some(result => result.status === 'rejected')) preparationFailed = true;
  }
  if (preparationFailed) throw new Error('Route notification device processing failed.');
}
