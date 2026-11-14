import { createHash } from 'node:crypto';
import type { UserRecord } from 'firebase-admin/auth';

export const INACTIVITY_DAY_MS = 86_400_000;
export const INACTIVITY_NOTICE_MS = 30 * INACTIVITY_DAY_MS;
export const INACTIVITY_CONTROL = 'configuration/inactiveAccounts';
export const INACTIVITY_COLLECTION = 'inactivityRetention';
export const INACTIVITY_TEMPLATE = 'account_inactivity_warning';
export const INACTIVITY_PAGE_SIZE = 100;
export const INACTIVITY_BUDGET_MS = 240_000;
export type { InactivityMode } from '../../../shared/admin-inactivity';
import type { InactivityMode } from '../../../shared/admin-inactivity';

export function inactivityMode(value: unknown): InactivityMode {
    return value === 'dry-run' || value === 'warnings-only' || value === 'enforce' ? value : 'off';
}

/** Calendar months in UTC, clamping August 31 -> February's last day. */
export function sixMonthsAfter(time: number): number {
    const date = new Date(time);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 6);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return date.getTime();
}

export function timestampMillis(value: unknown): number | null {
    try {
        const n = value && typeof (value as { toMillis?: unknown }).toMillis === 'function'
            ? (value as { toMillis(): number }).toMillis() : NaN;
        // Accept bounded milliseconds, including timestamp adapters that retain
        // submillisecond precision.
        return Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
    } catch { return null; }
}

export function emailFingerprint(email: string): string {
    // Any Auth email edit starts a fresh notice, including case-only edits.
    return createHash('sha256').update(email).digest('hex');
}

export interface InactiveIdentity { activityAt: number; createdAt: number; email: string; emailHash: string }

/** Unknown/malformed dates are never evidence of inactivity. Creation is not a login. */
export function inactiveIdentity(user: UserRecord, now: number): InactiveIdentity | null {
    if (user.disabled || user.tenantId || user.customClaims?.admin === true
        || !user.email || !/^[^\s@]+@[^\s@]+$/.test(user.email)
        || ![undefined, null, 'free'].includes(user.customClaims?.stripeRole)) return null;
    const grace = user.customClaims?.gracePeriodUntil;
    if (grace !== undefined && grace !== null && (typeof grace !== 'number' || !Number.isFinite(grace) || grace > now)) return null;
    const createdAt = Date.parse(user.metadata.creationTime);
    const times = [user.metadata.lastSignInTime, user.metadata.lastRefreshTime]
        .filter((value): value is string => value !== undefined && value !== null);
    if (!Number.isFinite(createdAt) || createdAt > now || !times.length) return null;
    const parsed = times.map(value => Date.parse(value));
    if (parsed.some(value => !Number.isFinite(value) || value < createdAt || value > now)) return null;
    const activityAt = Math.max(...parsed);
    if (sixMonthsAfter(activityAt) >= now) return null;
    return { activityAt, createdAt, email: user.email, emailHash: emailFingerprint(user.email) };
}

export function isTerminalSubscription(status: unknown): boolean {
    return status === 'canceled' || status === 'incomplete_expired';
}

/** A successful extension state alone does not prove this recipient was accepted. */
export function warningAcceptedAt(mail: Record<string, any>, uid: string, generation: string,
    email: string, queuedAt: number, now: number): number | null {
    const delivery = mail.delivery;
    const accepted = delivery?.info?.accepted;
    const end = timestampMillis(delivery?.endTime);
    if (mail.uid !== uid || mail.to !== email || mail.template?.name !== INACTIVITY_TEMPLATE
        || mail.inactivity?.generation !== generation || delivery?.state !== 'SUCCESS'
        || !Array.isArray(accepted) || accepted.length !== 1 || typeof accepted[0] !== 'string'
        || accepted[0].trim().toLowerCase() !== email.trim().toLowerCase()
        || !Array.isArray(delivery.info.rejected) || delivery.info.rejected.length
        || (delivery.info.pending !== undefined && (!Array.isArray(delivery.info.pending) || delivery.info.pending.length))
        || end === null || end < queuedAt || end > now) return null;
    return end;
}
