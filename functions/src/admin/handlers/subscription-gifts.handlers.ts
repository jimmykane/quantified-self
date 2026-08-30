import { createHash, randomUUID } from 'crypto';
import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/v2/https';
import type Stripe from 'stripe';
import type {
    AdminSubscriptionGiftCadence,
    AdminSubscriptionGiftHistoryItem,
    AdminSubscriptionGiftNotificationStatus,
    AdminSubscriptionGiftOperationStatus,
    AdminSubscriptionGiftRole,
    GrantAdminSubscriptionGiftRequest,
    GrantAdminSubscriptionGiftResponse,
    PreviewAdminSubscriptionGiftRequest,
    PreviewAdminSubscriptionGiftResponse,
} from '../../../../shared/admin-subscription-gifts';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import {
    EMAIL_LINKS,
    formatEmailDate,
    getRoleDisplayName,
    TRANSACTIONAL_EMAIL_FROM,
    TRANSACTIONAL_EMAIL_REPLY_TO,
} from '../../email/config';
import { FUNCTION_SECRET_BINDINGS } from '../../secrets';
import { onAdminCall } from '../../shared/auth';
import { getExpireAtTimestamp, TTL_CONFIG } from '../../shared/ttl-config';
import {
    getUserDeletionGuardState,
    getUserDeletionGuardStateInTransaction,
} from '../../shared/user-deletion-guard';
import { getAdminBillingStripe } from '../../stripe/client';
import {
    ADMIN_SUBSCRIPTION_GIFT_MAX_MONTHS,
    ADMIN_SUBSCRIPTION_GIFT_MIN_MONTHS,
    buildCurrentSubscriptionGiftState,
    buildEligibleSubscriptionGiftSnapshot,
    buildSubscriptionGiftMetadata,
    buildSubscriptionGiftPreviewVersion,
    stripeGiftOutcomeIsAmbiguous,
    subscriptionHasAppliedGift,
    SubscriptionGiftEligibilityError,
} from '../shared/subscription-gift.logic';

const GIFT_OPERATIONS_COLLECTION = 'adminSubscriptionGifts';
const GIFT_STATE_COLLECTION = 'adminSubscriptionGiftState';
const GIFT_LOCK_DOCUMENT = 'lock';
const GIFT_HISTORY_LIMIT = 5;
const GIFT_LEASE_MS = 2 * 60 * 1000;
const MAX_NOTIFICATION_ATTEMPTS = 3;
const OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAID_ROLES = new Set<AdminSubscriptionGiftRole>(['basic', 'pro']);

interface ValidatedPreviewRequest {
    uid: string;
    months: number;
}

interface ValidatedGrantRequest extends ValidatedPreviewRequest {
    reason: string;
    notifyUser: boolean;
    operationId: string;
    previewVersion: string;
}

interface GiftTarget {
    user: admin.auth.UserRecord;
    subscription: Stripe.Subscription;
    role: AdminSubscriptionGiftRole;
}

interface StoredGiftOperation {
    actorUid: string;
    months: number;
    reason: string;
    notifyUser: boolean;
    subscriptionId: string;
    role: AdminSubscriptionGiftRole;
    cadence: AdminSubscriptionGiftCadence;
    previewVersion: string;
    invariantVersion: string;
    previousAccessEndSeconds: number;
    targetAccessEndSeconds: number;
    cancelAtPeriodEnd: boolean;
    status: AdminSubscriptionGiftOperationStatus;
    notificationStatus: AdminSubscriptionGiftNotificationStatus;
    notificationAttempt: number;
    leaseToken: string | null;
    leaseExpiresAtMs: number | null;
}

interface AcquiredGiftOperation {
    operation: StoredGiftOperation;
    leaseToken: string | null;
    alreadySucceeded: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireExactKeys(data: Record<string, unknown>, expectedKeys: readonly string[]): void {
    const expected = new Set(expectedKeys);
    if (Object.keys(data).some(key => !expected.has(key))) {
        throw new HttpsError('invalid-argument', 'The request contains unsupported fields.');
    }
}

function validateUid(value: unknown): string {
    if (typeof value !== 'string' || value.length < 1 || value.length > 128 || value.trim() !== value || value.includes('/')) {
        throw new HttpsError('invalid-argument', 'A valid target user UID is required.');
    }
    return value;
}

function validateMonths(value: unknown): number {
    if (
        typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < ADMIN_SUBSCRIPTION_GIFT_MIN_MONTHS
        || value > ADMIN_SUBSCRIPTION_GIFT_MAX_MONTHS
    ) {
        throw new HttpsError('invalid-argument', 'Gift months must be an integer from 1 to 12.');
    }
    return value;
}

function validatePreviewRequest(value: unknown): ValidatedPreviewRequest {
    if (!isRecord(value)) {
        throw new HttpsError('invalid-argument', 'A subscription gift preview request is required.');
    }
    requireExactKeys(value, ['uid', 'months']);
    return {
        uid: validateUid(value.uid),
        months: validateMonths(value.months),
    };
}

function validateGrantRequest(value: unknown): ValidatedGrantRequest {
    if (!isRecord(value)) {
        throw new HttpsError('invalid-argument', 'A subscription gift request is required.');
    }
    requireExactKeys(value, ['uid', 'months', 'reason', 'notifyUser', 'operationId', 'previewVersion']);
    const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
    if (reason.length < 3 || reason.length > 500) {
        throw new HttpsError('invalid-argument', 'An internal reason between 3 and 500 characters is required.');
    }
    if (typeof value.notifyUser !== 'boolean') {
        throw new HttpsError('invalid-argument', 'notifyUser must be a boolean.');
    }
    if (typeof value.operationId !== 'string' || !OPERATION_ID_PATTERN.test(value.operationId)) {
        throw new HttpsError('invalid-argument', 'A valid operation ID is required.');
    }
    if (typeof value.previewVersion !== 'string' || !/^pv1_[A-Za-z0-9_-]{20,}$/.test(value.previewVersion)) {
        throw new HttpsError('invalid-argument', 'A valid preview version is required.');
    }
    return {
        uid: validateUid(value.uid),
        months: validateMonths(value.months),
        reason,
        notifyUser: value.notifyUser,
        operationId: value.operationId,
        previewVersion: value.previewVersion,
    };
}

function asPaidRole(value: unknown): AdminSubscriptionGiftRole | null {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return PAID_ROLES.has(normalized as AdminSubscriptionGiftRole)
        ? normalized as AdminSubscriptionGiftRole
        : null;
}

function resolveGiftRole(
    local: Record<string, unknown>,
    subscription: Stripe.Subscription,
    authClaim: unknown,
): AdminSubscriptionGiftRole | null {
    for (const candidate of [local.role, subscription.metadata?.role, subscription.metadata?.firebaseRole]) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return asPaidRole(candidate);
        }
    }
    return asPaidRole(authClaim);
}

function resolveSubscriptionId(documentId: string, data: Record<string, unknown>): string | null {
    const candidates = [data.id, data.subscription, data.stripeSubscriptionId, documentId];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.startsWith('sub_')) {
            return candidate;
        }
    }
    return null;
}

function mapGiftEligibilityError(error: SubscriptionGiftEligibilityError): HttpsError {
    return new HttpsError('failed-precondition', error.message);
}

async function validateTargetIdentity(
    db: admin.firestore.Firestore,
    uid: string,
    actorUid: string,
): Promise<admin.auth.UserRecord> {
    if (uid === actorUid) {
        throw new HttpsError('failed-precondition', 'Admins cannot gift subscription time to themselves.');
    }

    const [guard, targetUser] = await Promise.all([
        getUserDeletionGuardState(db, uid),
        admin.auth().getUser(uid).catch((error: unknown) => {
            const code = (error as { code?: unknown })?.code;
            if (code === 'auth/user-not-found') {
                throw new HttpsError('failed-precondition', 'The target account no longer exists.');
            }
            throw error;
        }),
    ]);
    if (guard.shouldSkip) {
        throw new HttpsError(
            'failed-precondition',
            guard.deletionInProgress
                ? 'The target account is pending deletion.'
                : 'The target account no longer exists.',
        );
    }
    if (targetUser.customClaims?.admin === true) {
        throw new HttpsError('failed-precondition', 'Admin accounts are not eligible for subscription gifts.');
    }
    return targetUser;
}

async function loadGiftTarget(
    db: admin.firestore.Firestore,
    stripe: Stripe,
    uid: string,
    actorUid: string,
): Promise<GiftTarget> {
    const [user, subscriptionsSnapshot] = await Promise.all([
        validateTargetIdentity(db, uid, actorUid),
        db.collection(`customers/${uid}/subscriptions`)
            .where('status', 'in', ['active', 'trialing'])
            .limit(2)
            .get(),
    ]);

    const candidates = await Promise.all(subscriptionsSnapshot.docs.map(async document => {
        const local = document.data() as Record<string, unknown>;
        const subscriptionId = resolveSubscriptionId(document.id, local);
        if (!subscriptionId) {
            return null;
        }
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const role = resolveGiftRole(local, subscription, user.customClaims?.stripeRole);
        if (!role || (subscription.status !== 'active' && subscription.status !== 'trialing')) {
            return null;
        }
        return { subscription, role };
    }));
    const paidCandidates: GiftTarget[] = candidates.flatMap(candidate => (
        candidate ? [{ ...candidate, user }] : []
    ));

    if (subscriptionsSnapshot.size === 0 || paidCandidates.length === 0) {
        throw new HttpsError('failed-precondition', 'The target must have one active or trialing Basic or Pro subscription.');
    }
    if (subscriptionsSnapshot.size !== 1 || paidCandidates.length !== 1) {
        throw new HttpsError('failed-precondition', 'The target has multiple current subscriptions and requires manual review.');
    }

    try {
        buildCurrentSubscriptionGiftState(paidCandidates[0].subscription, paidCandidates[0].role);
    } catch (error) {
        if (error instanceof SubscriptionGiftEligibilityError) {
            throw mapGiftEligibilityError(error);
        }
        throw error;
    }
    return paidCandidates[0];
}

function operationRef(db: admin.firestore.Firestore, uid: string, operationId: string): admin.firestore.DocumentReference {
    return db.doc(`users/${uid}/${GIFT_OPERATIONS_COLLECTION}/${operationId}`);
}

function lockRef(db: admin.firestore.Firestore, uid: string): admin.firestore.DocumentReference {
    return db.doc(`users/${uid}/${GIFT_STATE_COLLECTION}/${GIFT_LOCK_DOCUMENT}`);
}

function timestampToMillis(value: unknown): number | null {
    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value.getTime() : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (isRecord(value) && typeof value.toMillis === 'function') {
        const millis = (value.toMillis as () => number)();
        return Number.isFinite(millis) ? millis : null;
    }
    if (isRecord(value) && typeof value.seconds === 'number') {
        return Math.floor((value.seconds * 1000) + (typeof value.nanoseconds === 'number' ? value.nanoseconds / 1_000_000 : 0));
    }
    return null;
}

function timestampToSeconds(value: unknown): number | null {
    const millis = timestampToMillis(value);
    return millis === null ? null : Math.floor(millis / 1000);
}

function secondsToIso(value: number): string {
    return new Date(value * 1000).toISOString();
}

function parseOperationStatus(value: unknown): AdminSubscriptionGiftOperationStatus | null {
    return value === 'applying' || value === 'succeeded' || value === 'failed' || value === 'needs_review'
        ? value
        : null;
}

function parseNotificationStatus(value: unknown): AdminSubscriptionGiftNotificationStatus {
    return value === 'queued' || value === 'delivered' || value === 'failed' || value === 'not_requested'
        ? value
        : 'not_requested';
}

function parseStoredGiftOperation(data: Record<string, unknown> | undefined): StoredGiftOperation | null {
    if (!data) {
        return null;
    }
    const role = asPaidRole(data.role);
    const status = parseOperationStatus(data.status);
    const previousAccessEndSeconds = timestampToSeconds(data.previousAccessEnd);
    const targetAccessEndSeconds = timestampToSeconds(data.targetAccessEnd);
    const cadence = data.cadence === 'monthly' || data.cadence === 'yearly' || data.cadence === 'unknown'
        ? data.cadence
        : null;
    if (
        !role
        || !status
        || !cadence
        || typeof data.actorUid !== 'string'
        || typeof data.months !== 'number'
        || typeof data.reason !== 'string'
        || typeof data.notifyUser !== 'boolean'
        || typeof data.subscriptionId !== 'string'
        || typeof data.previewVersion !== 'string'
        || typeof data.invariantVersion !== 'string'
        || previousAccessEndSeconds === null
        || targetAccessEndSeconds === null
        || typeof data.cancelAtPeriodEnd !== 'boolean'
    ) {
        return null;
    }
    return {
        actorUid: data.actorUid,
        months: data.months,
        reason: data.reason,
        notifyUser: data.notifyUser,
        subscriptionId: data.subscriptionId,
        role,
        cadence,
        previewVersion: data.previewVersion,
        invariantVersion: data.invariantVersion,
        previousAccessEndSeconds,
        targetAccessEndSeconds,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd,
        status,
        notificationStatus: parseNotificationStatus(data.notificationStatus),
        notificationAttempt: typeof data.notificationAttempt === 'number' && Number.isSafeInteger(data.notificationAttempt)
            ? Math.max(0, data.notificationAttempt)
            : 0,
        leaseToken: typeof data.leaseToken === 'string' ? data.leaseToken : null,
        leaseExpiresAtMs: timestampToMillis(data.leaseExpiresAt),
    };
}

function operationMatchesRequest(operation: StoredGiftOperation, request: ValidatedGrantRequest): boolean {
    return operation.months === request.months
        && operation.reason === request.reason
        && operation.notifyUser === request.notifyUser
        && operation.previewVersion === request.previewVersion;
}

async function readStoredOperation(
    db: admin.firestore.Firestore,
    uid: string,
    operationId: string,
): Promise<StoredGiftOperation | null> {
    const snapshot = await operationRef(db, uid, operationId).get();
    if (!snapshot.exists) {
        return null;
    }
    const operation = parseStoredGiftOperation(snapshot.data() as Record<string, unknown> | undefined);
    if (!operation) {
        throw new HttpsError('failed-precondition', 'This gift operation requires manual review.');
    }
    return operation;
}

async function acquireGiftOperation(
    db: admin.firestore.Firestore,
    actorUid: string,
    request: ValidatedGrantRequest,
    target: GiftTarget,
    preview: ReturnType<typeof buildEligibleSubscriptionGiftSnapshot>,
): Promise<AcquiredGiftOperation> {
    const giftOperationRef = operationRef(db, request.uid, request.operationId);
    const giftLockRef = lockRef(db, request.uid);
    const leaseToken = randomUUID();
    const nowMs = Date.now();

    return db.runTransaction(async transaction => {
        const [guard, operationSnapshot, lockSnapshot] = await Promise.all([
            getUserDeletionGuardStateInTransaction(db, transaction, request.uid, nowMs),
            transaction.get(giftOperationRef),
            transaction.get(giftLockRef),
        ]);
        if (guard.shouldSkip) {
            throw new HttpsError('failed-precondition', 'The target account is missing or pending deletion.');
        }

        const existing = operationSnapshot.exists
            ? parseStoredGiftOperation(operationSnapshot.data() as Record<string, unknown> | undefined)
            : null;
        if (operationSnapshot.exists && !existing) {
            throw new HttpsError('failed-precondition', 'This gift operation requires manual review.');
        }
        if (existing && !operationMatchesRequest(existing, request)) {
            throw new HttpsError('already-exists', 'The operation ID is already associated with another request.');
        }
        if (existing?.status === 'succeeded') {
            return { operation: existing, leaseToken: null, alreadySucceeded: true };
        }

        const lockData = lockSnapshot.data() as Record<string, unknown> | undefined;
        const lockStatus = lockData?.status;
        const lockOperationId = typeof lockData?.operationId === 'string' ? lockData.operationId : null;
        const lockLeaseExpiresAtMs = timestampToMillis(lockData?.leaseExpiresAt);
        if (lockStatus === 'needs_review' && lockOperationId !== request.operationId) {
            throw new HttpsError('failed-precondition', 'A previous gift operation requires manual review.');
        }
        if (lockStatus === 'applying') {
            const leaseIsActive = lockLeaseExpiresAtMs !== null && lockLeaseExpiresAtMs > nowMs;
            if (lockOperationId !== request.operationId) {
                if (leaseIsActive) {
                    throw new HttpsError('aborted', 'Another gift operation is still in progress. Retry shortly.');
                }
                throw new HttpsError(
                    'failed-precondition',
                    'A previous gift operation must be reconciled using its original operation ID.',
                );
            }
            if (leaseIsActive) {
                throw new HttpsError('aborted', 'This gift operation is still in progress. Retry shortly.');
            }
        }

        const storedOperation: StoredGiftOperation = existing || {
            actorUid,
            months: request.months,
            reason: request.reason,
            notifyUser: request.notifyUser,
            subscriptionId: target.subscription.id,
            role: preview.role,
            cadence: preview.cadence,
            previewVersion: preview.previewVersion,
            invariantVersion: preview.invariantVersion,
            previousAccessEndSeconds: preview.currentAccessEndSeconds,
            targetAccessEndSeconds: preview.targetAccessEndSeconds,
            cancelAtPeriodEnd: preview.cancelAtPeriodEnd,
            status: 'applying',
            notificationStatus: 'not_requested',
            notificationAttempt: 0,
            leaseToken,
            leaseExpiresAtMs: nowMs + GIFT_LEASE_MS,
        };

        const writePayload = {
            schemaVersion: 1,
            actorUid: storedOperation.actorUid,
            lastAttemptActorUid: actorUid,
            months: storedOperation.months,
            reason: storedOperation.reason,
            notifyUser: storedOperation.notifyUser,
            subscriptionId: storedOperation.subscriptionId,
            role: storedOperation.role,
            cadence: storedOperation.cadence,
            previewVersion: storedOperation.previewVersion,
            invariantVersion: storedOperation.invariantVersion,
            previousAccessEnd: Timestamp.fromMillis(storedOperation.previousAccessEndSeconds * 1000),
            targetAccessEnd: Timestamp.fromMillis(storedOperation.targetAccessEndSeconds * 1000),
            cancelAtPeriodEnd: storedOperation.cancelAtPeriodEnd,
            status: 'applying',
            notificationStatus: storedOperation.notificationStatus,
            notificationAttempt: storedOperation.notificationAttempt,
            leaseToken,
            leaseExpiresAt: Timestamp.fromMillis(nowMs + GIFT_LEASE_MS),
            updatedAt: FieldValue.serverTimestamp(),
            ...(existing ? {} : { createdAt: FieldValue.serverTimestamp() }),
        };
        if (existing) {
            transaction.set(giftOperationRef, writePayload, { merge: true });
        } else {
            transaction.create(giftOperationRef, writePayload);
        }
        transaction.set(giftLockRef, {
            status: 'applying',
            operationId: request.operationId,
            leaseToken,
            leaseExpiresAt: Timestamp.fromMillis(nowMs + GIFT_LEASE_MS),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        return {
            operation: {
                ...storedOperation,
                status: 'applying',
                leaseToken,
                leaseExpiresAtMs: nowMs + GIFT_LEASE_MS,
            },
            leaseToken,
            alreadySucceeded: false,
        };
    });
}

async function finalizeGiftOperation(
    db: admin.firestore.Firestore,
    uid: string,
    operationId: string,
    leaseToken: string,
    status: 'succeeded' | 'failed' | 'needs_review',
    resultCode: string,
): Promise<boolean> {
    const giftOperationRef = operationRef(db, uid, operationId);
    const giftLockRef = lockRef(db, uid);
    return db.runTransaction(async transaction => {
        const [guard, operationSnapshot, lockSnapshot] = await Promise.all([
            getUserDeletionGuardStateInTransaction(db, transaction, uid),
            transaction.get(giftOperationRef),
            transaction.get(giftLockRef),
        ]);
        if (guard.shouldSkip) {
            return false;
        }
        const lock = lockSnapshot.data() as Record<string, unknown> | undefined;
        if (
            !operationSnapshot.exists
            || lock?.operationId !== operationId
            || lock?.leaseToken !== leaseToken
        ) {
            return false;
        }

        transaction.set(giftOperationRef, {
            status,
            resultCode,
            leaseToken: FieldValue.delete(),
            leaseExpiresAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
            ...(status === 'succeeded' ? { completedAt: FieldValue.serverTimestamp() } : {}),
        }, { merge: true });
        transaction.set(giftLockRef, {
            status: status === 'needs_review' ? 'needs_review' : 'idle',
            operationId,
            leaseToken: FieldValue.delete(),
            leaseExpiresAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return true;
    });
}

function buildResponse(
    operationId: string,
    operation: StoredGiftOperation,
    status: 'succeeded' | 'failed' | 'needs_review',
    notificationStatus = operation.notificationStatus,
    message?: string,
): GrantAdminSubscriptionGiftResponse {
    return {
        operationId,
        status,
        previousAccessEnd: secondsToIso(operation.previousAccessEndSeconds),
        newAccessEnd: secondsToIso(operation.targetAccessEndSeconds),
        cancelAtPeriodEnd: operation.cancelAtPeriodEnd,
        notificationStatus,
        ...(message ? { message } : {}),
    };
}

function idempotencyKey(uid: string, operationId: string): string {
    const digest = createHash('sha256').update(`${uid}\u0000${operationId}`).digest('hex');
    return `admin-subscription-gift-v1-${digest}`;
}

function mailDocumentId(uid: string, operationId: string, attempt: number): string {
    const digest = createHash('sha256').update(`${uid}\u0000${operationId}`).digest('hex').slice(0, 40);
    return `subscription_time_gift_${digest}_a${attempt}`;
}

function isDeliveryError(data: Record<string, unknown> | undefined): boolean {
    const delivery = isRecord(data?.delivery) ? data.delivery : null;
    return typeof delivery?.state === 'string' && delivery.state.toUpperCase() === 'ERROR';
}

function isDeliverySuccess(data: Record<string, unknown> | undefined): boolean {
    const delivery = isRecord(data?.delivery) ? data.delivery : null;
    return typeof delivery?.state === 'string' && delivery.state.toUpperCase() === 'SUCCESS';
}

async function updateNotificationFailure(
    db: admin.firestore.Firestore,
    uid: string,
    operationId: string,
    resultCode: string,
): Promise<void> {
    try {
        await db.runTransaction(async transaction => {
            const guard = await getUserDeletionGuardStateInTransaction(db, transaction, uid);
            if (guard.shouldSkip) {
                return;
            }
            transaction.set(operationRef(db, uid, operationId), {
                notificationStatus: 'failed',
                notificationResultCode: resultCode,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        });
    } catch (error) {
        logger.warn('[admin-subscription-gift] Could not persist notification failure.', {
            uid,
            operationId,
            code: (error as { code?: unknown })?.code || 'unknown',
        });
    }
}

async function queueGiftNotification(
    db: admin.firestore.Firestore,
    uid: string,
    operationId: string,
    operation: StoredGiftOperation,
): Promise<AdminSubscriptionGiftNotificationStatus> {
    if (!operation.notifyUser) {
        return 'not_requested';
    }

    let recipient: string | undefined;
    try {
        recipient = (await admin.auth().getUser(uid)).email;
    } catch {
        await updateNotificationFailure(db, uid, operationId, 'recipient_unavailable');
        return 'failed';
    }
    if (!recipient) {
        await updateNotificationFailure(db, uid, operationId, 'recipient_missing_email');
        return 'failed';
    }

    try {
        return await db.runTransaction(async transaction => {
            const giftOperationRef = operationRef(db, uid, operationId);
            const [guard, operationSnapshot] = await Promise.all([
                getUserDeletionGuardStateInTransaction(db, transaction, uid),
                transaction.get(giftOperationRef),
            ]);
            if (guard.shouldSkip || !operationSnapshot.exists) {
                return 'failed' as const;
            }
            const latestOperation = parseStoredGiftOperation(
                operationSnapshot.data() as Record<string, unknown> | undefined,
            );
            if (!latestOperation || latestOperation.status !== 'succeeded') {
                return 'failed' as const;
            }

            const currentAttempt = Math.min(latestOperation.notificationAttempt, MAX_NOTIFICATION_ATTEMPTS);
            const currentMailRef = db.collection('mail').doc(mailDocumentId(uid, operationId, currentAttempt));
            const currentMail = await transaction.get(currentMailRef);
            const currentMailData = currentMail.data() as Record<string, unknown> | undefined;
            if (currentMail.exists && isDeliverySuccess(currentMailData)) {
                transaction.set(giftOperationRef, {
                    notificationStatus: 'delivered',
                    notificationResultCode: 'delivered',
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
                return 'delivered' as const;
            }
            if (currentMail.exists && !isDeliveryError(currentMailData)) {
                transaction.set(giftOperationRef, {
                    notificationStatus: 'queued',
                    notificationResultCode: 'already_queued',
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
                return 'queued' as const;
            }

            const nextAttempt = currentMail.exists ? currentAttempt + 1 : currentAttempt;
            if (nextAttempt > MAX_NOTIFICATION_ATTEMPTS) {
                transaction.set(giftOperationRef, {
                    notificationStatus: 'failed',
                    notificationResultCode: 'retry_limit_reached',
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
                return 'failed' as const;
            }
            const nextMailRef = db.collection('mail').doc(mailDocumentId(uid, operationId, nextAttempt));
            const nextMail = nextAttempt === currentAttempt ? currentMail : await transaction.get(nextMailRef);
            if (!nextMail.exists) {
                transaction.create(nextMailRef, {
                    to: recipient,
                    toUids: [uid],
                    from: TRANSACTIONAL_EMAIL_FROM,
                    replyTo: TRANSACTIONAL_EMAIL_REPLY_TO,
                    template: {
                        name: 'subscription_time_gift',
                        data: {
                            role: getRoleDisplayName(operation.role),
                            gifted_months: operation.months,
                            gifted_period_label: operation.months === 1 ? '1 month' : `${operation.months} months`,
                            new_access_date: formatEmailDate(new Date(operation.targetAccessEndSeconds * 1000)),
                            membership_url: EMAIL_LINKS.membership,
                        },
                    },
                    adminSubscriptionGift: {
                        uid,
                        operationId,
                        attempt: nextAttempt,
                    },
                    expireAt: getExpireAtTimestamp(TTL_CONFIG.MAIL_IN_DAYS),
                });
            }
            transaction.set(giftOperationRef, {
                notificationStatus: 'queued',
                notificationAttempt: nextAttempt,
                notificationResultCode: nextMail.exists ? 'already_queued' : 'queued',
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            return 'queued' as const;
        });
    } catch (error) {
        logger.warn('[admin-subscription-gift] Could not queue the optional notification.', {
            uid,
            operationId,
            code: (error as { code?: unknown })?.code || 'unknown',
        });
        await updateNotificationFailure(db, uid, operationId, 'queue_failed');
        return 'failed';
    }
}

async function getRecentHistory(
    db: admin.firestore.Firestore,
    uid: string,
): Promise<AdminSubscriptionGiftHistoryItem[]> {
    const snapshot = await db.collection(`users/${uid}/${GIFT_OPERATIONS_COLLECTION}`)
        .orderBy('createdAt', 'desc')
        .limit(GIFT_HISTORY_LIMIT)
        .get();
    return snapshot.docs.flatMap(document => {
        const data = document.data() as Record<string, unknown>;
        const operation = parseStoredGiftOperation(data);
        if (!operation) {
            return [];
        }
        const createdAtMs = timestampToMillis(data.createdAt);
        return [{
            operationId: document.id,
            months: operation.months,
            reason: operation.reason,
            actorUid: operation.actorUid,
            status: operation.status,
            previousAccessEnd: secondsToIso(operation.previousAccessEndSeconds),
            newAccessEnd: secondsToIso(operation.targetAccessEndSeconds),
            notificationStatus: operation.notificationStatus,
            createdAt: createdAtMs === null ? null : new Date(createdAtMs).toISOString(),
        }];
    });
}

export const previewAdminSubscriptionGift = onAdminCall<
    PreviewAdminSubscriptionGiftRequest,
    PreviewAdminSubscriptionGiftResponse
>({
    region: FUNCTIONS_MANIFEST.previewAdminSubscriptionGift.region,
    memory: '256MiB',
    secrets: FUNCTION_SECRET_BINDINGS.previewAdminSubscriptionGift,
}, async request => {
    const input = validatePreviewRequest(request.data);
    const db = admin.firestore();
    const stripe = await getAdminBillingStripe();
    const target = await loadGiftTarget(db, stripe, input.uid, request.auth!.uid);

    let preview: ReturnType<typeof buildEligibleSubscriptionGiftSnapshot>;
    try {
        preview = buildEligibleSubscriptionGiftSnapshot(target.subscription, target.role, input.months);
    } catch (error) {
        if (error instanceof SubscriptionGiftEligibilityError) {
            throw mapGiftEligibilityError(error);
        }
        throw error;
    }
    const recentHistory = await getRecentHistory(db, input.uid);

    return {
        uid: input.uid,
        subscriptionId: preview.subscriptionId,
        role: preview.role,
        cadence: preview.cadence,
        status: preview.status,
        currentAccessEnd: secondsToIso(preview.currentAccessEndSeconds),
        proposedGiftedEnd: secondsToIso(preview.targetAccessEndSeconds),
        cancelAtPeriodEnd: preview.cancelAtPeriodEnd,
        previewVersion: preview.previewVersion,
        recentHistory,
    };
});

export const grantAdminSubscriptionGift = onAdminCall<
    GrantAdminSubscriptionGiftRequest,
    GrantAdminSubscriptionGiftResponse
>({
    region: FUNCTIONS_MANIFEST.grantAdminSubscriptionGift.region,
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: FUNCTION_SECRET_BINDINGS.grantAdminSubscriptionGift,
}, async request => {
    const input = validateGrantRequest(request.data);
    const actorUid = request.auth!.uid;
    const db = admin.firestore();
    const existingOperation = await readStoredOperation(db, input.uid, input.operationId);
    if (existingOperation && !operationMatchesRequest(existingOperation, input)) {
        throw new HttpsError('already-exists', 'The operation ID is already associated with another request.');
    }
    if (existingOperation?.status === 'succeeded') {
        await validateTargetIdentity(db, input.uid, actorUid);
        const notificationStatus = await queueGiftNotification(
            db,
            input.uid,
            input.operationId,
            existingOperation,
        );
        return buildResponse(input.operationId, existingOperation, 'succeeded', notificationStatus);
    }

    const stripe = await getAdminBillingStripe();
    let target: GiftTarget;
    try {
        target = await loadGiftTarget(db, stripe, input.uid, actorUid);
    } catch (error) {
        if (existingOperation) {
            await db.runTransaction(async transaction => {
                const guard = await getUserDeletionGuardStateInTransaction(db, transaction, input.uid);
                if (guard.shouldSkip) {
                    return;
                }
                transaction.set(operationRef(db, input.uid, input.operationId), {
                    status: 'needs_review',
                    resultCode: 'subscription_state_changed',
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
                transaction.set(lockRef(db, input.uid), {
                    status: 'needs_review',
                    operationId: input.operationId,
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
            });
            return buildResponse(
                input.operationId,
                existingOperation,
                'needs_review',
                existingOperation.notificationStatus,
                'The subscription changed and requires manual review.',
            );
        }
        throw error;
    }

    let preview: ReturnType<typeof buildEligibleSubscriptionGiftSnapshot>;
    try {
        preview = buildEligibleSubscriptionGiftSnapshot(target.subscription, target.role, input.months);
    } catch (error) {
        if (error instanceof SubscriptionGiftEligibilityError) {
            throw mapGiftEligibilityError(error);
        }
        throw error;
    }
    if (!existingOperation && preview.previewVersion !== input.previewVersion) {
        throw new HttpsError('failed-precondition', 'The subscription changed after preview. Refresh the preview and try again.');
    }

    const acquired = await acquireGiftOperation(db, actorUid, input, target, preview);
    if (acquired.alreadySucceeded) {
        const notificationStatus = await queueGiftNotification(
            db,
            input.uid,
            input.operationId,
            acquired.operation,
        );
        return buildResponse(input.operationId, acquired.operation, 'succeeded', notificationStatus);
    }
    const leaseToken = acquired.leaseToken;
    if (!leaseToken) {
        throw new HttpsError('internal', 'The gift operation lease could not be acquired.');
    }

    let currentSubscription: Stripe.Subscription;
    try {
        currentSubscription = await stripe.subscriptions.retrieve(acquired.operation.subscriptionId);
    } catch (error) {
        const status: AdminSubscriptionGiftOperationStatus = existingOperation ? 'needs_review' : 'failed';
        await finalizeGiftOperation(
            db,
            input.uid,
            input.operationId,
            leaseToken,
            status,
            existingOperation ? 'stripe_reconciliation_unavailable' : 'stripe_subscription_read_failed',
        );
        logger.warn('[admin-subscription-gift] Stripe subscription verification failed.', {
            uid: input.uid,
            operationId: input.operationId,
            outcome: status,
            type: (error as { type?: unknown })?.type || 'unknown',
            statusCode: (error as { statusCode?: unknown })?.statusCode || null,
        });
        return buildResponse(
            input.operationId,
            acquired.operation,
            status,
            acquired.operation.notificationStatus,
            existingOperation
                ? 'Stripe could not verify whether the prior operation was applied. Review or retry the same operation.'
                : 'Stripe could not verify the current subscription. Nothing was changed.',
        );
    }
    if (subscriptionHasAppliedGift(
        currentSubscription,
        input.operationId,
        acquired.operation.targetAccessEndSeconds,
    )) {
        const finalized = await finalizeGiftOperation(
            db,
            input.uid,
            input.operationId,
            leaseToken,
            'succeeded',
            'reconciled',
        );
        if (!finalized) {
            throw new HttpsError('unavailable', 'The gift was applied but its audit record could not be finalized. Retry the same operation.');
        }
        const succeededOperation = { ...acquired.operation, status: 'succeeded' as const };
        const notificationStatus = await queueGiftNotification(db, input.uid, input.operationId, succeededOperation);
        return buildResponse(input.operationId, succeededOperation, 'succeeded', notificationStatus);
    }

    const currentPreviewVersion = buildSubscriptionGiftPreviewVersion(
        currentSubscription,
        acquired.operation.role,
        acquired.operation.months,
    );
    if (
        currentSubscription.id !== acquired.operation.subscriptionId
        || target.role !== acquired.operation.role
        || currentPreviewVersion !== acquired.operation.previewVersion
    ) {
        await finalizeGiftOperation(
            db,
            input.uid,
            input.operationId,
            leaseToken,
            'needs_review',
            'subscription_state_changed',
        );
        return buildResponse(
            input.operationId,
            acquired.operation,
            'needs_review',
            acquired.operation.notificationStatus,
            'The subscription changed and requires manual review.',
        );
    }

    let updatedSubscription: Stripe.Subscription;
    try {
        updatedSubscription = await stripe.subscriptions.update(
            acquired.operation.subscriptionId,
            {
                trial_end: acquired.operation.targetAccessEndSeconds,
                proration_behavior: 'none',
                metadata: buildSubscriptionGiftMetadata(
                    input.operationId,
                    acquired.operation.months,
                    acquired.operation.targetAccessEndSeconds,
                ),
            },
            { idempotencyKey: idempotencyKey(input.uid, input.operationId) },
        );
    } catch (error) {
        const ambiguous = stripeGiftOutcomeIsAmbiguous(error);
        const status = ambiguous ? 'needs_review' : 'failed';
        await finalizeGiftOperation(
            db,
            input.uid,
            input.operationId,
            leaseToken,
            status,
            ambiguous ? 'stripe_outcome_ambiguous' : 'stripe_request_rejected',
        );
        logger.warn('[admin-subscription-gift] Stripe did not return a successful gift response.', {
            uid: input.uid,
            operationId: input.operationId,
            outcome: status,
            type: (error as { type?: unknown })?.type || 'unknown',
            statusCode: (error as { statusCode?: unknown })?.statusCode || null,
        });
        return buildResponse(
            input.operationId,
            acquired.operation,
            status,
            acquired.operation.notificationStatus,
            ambiguous
                ? 'Stripe’s outcome is uncertain. Review this operation before granting more time.'
                : 'Stripe rejected the request. The subscription was not changed.',
        );
    }

    let invariantsPreserved = false;
    try {
        invariantsPreserved = buildCurrentSubscriptionGiftState(
            updatedSubscription,
            acquired.operation.role,
        ).invariantVersion === acquired.operation.invariantVersion;
    } catch {
        invariantsPreserved = false;
    }
    const applied = subscriptionHasAppliedGift(
        updatedSubscription,
        input.operationId,
        acquired.operation.targetAccessEndSeconds,
    );
    const cancellationPreserved = updatedSubscription.cancel_at_period_end === acquired.operation.cancelAtPeriodEnd;
    if (!applied || !invariantsPreserved || !cancellationPreserved) {
        await finalizeGiftOperation(
            db,
            input.uid,
            input.operationId,
            leaseToken,
            'needs_review',
            'stripe_response_invariant_failed',
        );
        return buildResponse(
            input.operationId,
            acquired.operation,
            'needs_review',
            acquired.operation.notificationStatus,
            'Stripe changed the subscription, but the result requires manual review.',
        );
    }

    const finalized = await finalizeGiftOperation(
        db,
        input.uid,
        input.operationId,
        leaseToken,
        'succeeded',
        'applied',
    );
    if (!finalized) {
        throw new HttpsError('unavailable', 'The gift was applied but its audit record could not be finalized. Retry the same operation.');
    }

    const succeededOperation = { ...acquired.operation, status: 'succeeded' as const };
    const notificationStatus = await queueGiftNotification(db, input.uid, input.operationId, succeededOperation);
    return buildResponse(input.operationId, succeededOperation, 'succeeded', notificationStatus);
});
