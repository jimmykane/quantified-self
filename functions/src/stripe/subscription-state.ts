import * as admin from 'firebase-admin';
import { calculateGracePeriodEnd } from '../../../shared/limits';

export interface SubscriptionSnapshotLike {
    id: string;
    data(): FirebaseFirestore.DocumentData;
}

export interface CanonicalEndingSubscription {
    subscriptionId: string;
    subscription: FirebaseFirestore.DocumentData;
    currentPeriodEndMs: number;
    scheduledGracePeriodUntil: admin.firestore.Timestamp;
}

export function getTimestampMillis(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? time : null;
    }

    if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
        const time = (value as { toMillis: () => number }).toMillis();
        return Number.isFinite(time) ? time : null;
    }

    if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
        const time = (value as { toDate: () => Date }).toDate().getTime();
        return Number.isFinite(time) ? time : null;
    }

    if (value && typeof value === 'object' && 'seconds' in (value as Record<string, unknown>)) {
        const seconds = Number((value as Record<string, unknown>).seconds);
        const nanoseconds = Number((value as Record<string, unknown>).nanoseconds || 0);
        if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
            return Math.floor((seconds * 1000) + (nanoseconds / 1_000_000));
        }
    }

    return null;
}

export function isActiveSubscription(
    subscription: FirebaseFirestore.DocumentData | undefined,
): boolean {
    return !!subscription && ['active', 'trialing'].includes(subscription.status);
}

export function getGracePeriodUntilFromSubscriptionPeriodEnd(
    subscription: FirebaseFirestore.DocumentData | undefined,
): admin.firestore.Timestamp | null {
    const currentPeriodEndMs = getTimestampMillis(subscription?.current_period_end);
    if (currentPeriodEndMs === null) {
        return null;
    }

    return admin.firestore.Timestamp.fromDate(calculateGracePeriodEnd(currentPeriodEndMs));
}

export function getCanonicalEndingSubscription(
    activeSubscriptions: readonly SubscriptionSnapshotLike[],
): CanonicalEndingSubscription | null {
    if (activeSubscriptions.length === 0) {
        return null;
    }

    const endingSubscriptions: CanonicalEndingSubscription[] = [];
    for (const subscriptionDoc of activeSubscriptions) {
        const subscription = subscriptionDoc.data();
        if (!isActiveSubscription(subscription) || subscription.cancel_at_period_end !== true) {
            // At least one active subscription will continue, so the user's paid
            // entitlement is not scheduled to end.
            return null;
        }

        const currentPeriodEndMs = getTimestampMillis(subscription.current_period_end);
        const scheduledGracePeriodUntil = getGracePeriodUntilFromSubscriptionPeriodEnd(subscription);
        if (currentPeriodEndMs === null || !scheduledGracePeriodUntil) {
            // Without a valid end date we cannot promise a canonical deadline.
            return null;
        }

        endingSubscriptions.push({
            subscriptionId: subscriptionDoc.id,
            subscription,
            currentPeriodEndMs,
            scheduledGracePeriodUntil,
        });
    }

    return endingSubscriptions.reduce((latest, candidate) => {
        if (candidate.currentPeriodEndMs !== latest.currentPeriodEndMs) {
            return candidate.currentPeriodEndMs > latest.currentPeriodEndMs ? candidate : latest;
        }

        // Firestore does not guarantee query order here. Use the ID as a stable
        // tie-breaker so every worker selects the same canonical subscription.
        return candidate.subscriptionId > latest.subscriptionId ? candidate : latest;
    });
}
