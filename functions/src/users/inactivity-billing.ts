import { createHash } from 'node:crypto';
import type Stripe from 'stripe';
import type { Firestore, Transaction, DocumentSnapshot, Query, QuerySnapshot } from 'firebase-admin/firestore';
import { isTerminalSubscription, timestampMillis } from './inactivity-policy';

export interface InactivityBilling { eligible: boolean; customerId: string | null; revision: string }

/** All queries are bounded; an incomplete history is a hold, never evidence of Free. */
export async function readInactivityBilling(db: Firestore, uid: string, now: number, tx?: Transaction): Promise<InactivityBilling> {
    const paths = [`users/${uid}`, `users/${uid}/system/status`, `customers/${uid}`,
        `stripeBillingAccounts/${uid}`, `users/${uid}/adminSubscriptionGiftState/lock`, 'configuration/stripeBilling'];
    const refs = paths.map(path => db.doc(path));
    const [user, status, customer, account, gift, control] = tx ? await tx.getAll(...refs) : await db.getAll(...refs);
    const query = (q: Query): Promise<QuerySnapshot> => tx ? tx.get(q) : q.get();
    const [subscriptions, jobs, checkouts] = await Promise.all([
        query(db.collection(`customers/${uid}/subscriptions`).limit(101)),
        query(db.collection('stripeBillingJobs').where('uid', '==', uid).where('state', 'in', ['pending', 'failed']).limit(1)),
        query(db.collection(`customers/${uid}/checkout_sessions`).limit(101)),
    ]);
    const a = customer.get('stripeId');
    const b = account.get('customerId');
    const validId = (value: unknown): value is string => typeof value === 'string' && /^cus_[A-Za-z0-9]+$/.test(value);
    const customerId = validId(a) ? a : validId(b) ? b : null;
    const grace = ['gracePeriodUntil', 'scheduledGracePeriodUntil'].some(key => {
        const value = status.get(key);
        return value !== undefined && value !== null && (timestampMillis(value) === null || timestampMillis(value)! > now);
    });
    const history = user.get('hasSubscribedOnce') === true || subscriptions.size > 0;
    const activeCheckout = account.get('activeCheckout');
    let operation: DocumentSnapshot | undefined;
    if (typeof activeCheckout === 'string' && activeCheckout && !activeCheckout.includes('/')) {
        const ref = db.doc(`stripeBillingAccounts/${uid}/operations/${activeCheckout}`);
        operation = tx ? await tx.get(ref) : await ref.get();
    }
    const snapshots = [customer, account, gift, ...subscriptions.docs, ...checkouts.docs, ...jobs.docs, ...(operation ? [operation] : [])];
    // Daily claims reconciliation updates claimsUpdatedAt even for unchanged Free
    // accounts. Only entitlement fields from system/status can reset this notice.
    const revision = createHash('sha256').update(JSON.stringify({
        grace: ['gracePeriodUntil', 'scheduledGracePeriodUntil'].map(key => status.get(key) ?? null),
        documents: snapshots.map(s => [s.ref.path, s.updateTime?.seconds ?? null, s.updateTime?.nanoseconds ?? null])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    })).digest('hex');
    const eligible = user.exists && control.get('owner') === 'native' && timestampMillis(control.get('nativeSince')) !== null
        && timestampMillis(control.get('nativeSince'))! <= now
        && !grace && !account.get('deleting') && jobs.empty
        && subscriptions.size < 101 && subscriptions.docs.every(s => isTerminalSubscription(s.get('status')))
        && checkouts.size < 101 && checkouts.docs.every(s => typeof s.get('sessionId') === 'string')
        && (!gift.exists || gift.get('status') === 'idle')
        && (a === undefined || validId(a)) && (b === undefined || validId(b)) && (!a || !b || a === b)
        && (!history || !!customerId)
        && (!activeCheckout || !!operation && (operation.get('rejected') === true || typeof operation.get('result.id') === 'string'));
    return { eligible, customerId, revision };
}

/** Read only. Never recover/link a customer or change claims during retention checks. */
export async function stripeAllowsInactivity(stripe: Stripe, uid: string, email: string, customerId: string | null, warnedAt?: number): Promise<boolean> {
    // A different customer with this email is ambiguity, not permission to transfer ownership.
    // List (not eventually consistent Search) also protects unbound paid accounts.
    const matches = await stripe.customers.list({ email, limit: 100 });
    if (matches.has_more || matches.data.some(customer => customer.id !== customerId)) return false;
    if (!customerId) return matches.data.length === 0;
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted || [customer.metadata.firebaseUID, customer.metadata.linkedToUid].some(owner => owner && owner !== uid)) return false;
    const [subscriptions, schedules, sessions] = await Promise.all([
        stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 }),
        stripe.subscriptionSchedules.list({ customer: customerId, limit: 100 }),
        stripe.checkout.sessions.list({ customer: customerId, limit: 100 }),
    ]);
    if (subscriptions.has_more || schedules.has_more || sessions.has_more) return false;
    const afterWarning = (seconds: number | null | undefined) => warnedAt !== undefined && typeof seconds === 'number' && seconds * 1000 > warnedAt;
    return subscriptions.data.every(subscription => isTerminalSubscription(subscription.status)
            && ![subscription.created, subscription.canceled_at, subscription.ended_at].some(afterWarning))
        && schedules.data.every(schedule => ['canceled', 'completed', 'released'].includes(schedule.status) && !afterWarning(schedule.created))
        && sessions.data.every(session => !afterWarning(session.created) && (session.status === 'expired'
            || session.status === 'complete' && ['paid', 'no_payment_required'].includes(session.payment_status)));
}
