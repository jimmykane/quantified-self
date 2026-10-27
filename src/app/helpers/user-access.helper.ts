import type { User } from '@sports-alliance/sports-lib';
import type { AppUserInterface } from '../models/app-user.interface';

/** Synchronous account access policy, independent of chart and settings initialization. */
export class AppUserAccess {
    /** Shared deadline for grace-period checks and UI expiry scheduling. */
    public static getGracePeriodExpiryMs(user: AppUserInterface | User | null): number | null {
        const gracePeriodUntil: unknown = (user as AppUserInterface | null)?.gracePeriodUntil;
        let expiryMillis: unknown = gracePeriodUntil;
        if (gracePeriodUntil && typeof gracePeriodUntil === 'object') {
            if ('toMillis' in gracePeriodUntil && typeof gracePeriodUntil.toMillis === 'function') {
                expiryMillis = gracePeriodUntil.toMillis();
            } else if ('getTime' in gracePeriodUntil && typeof gracePeriodUntil.getTime === 'function') {
                expiryMillis = gracePeriodUntil.getTime();
            } else if ('seconds' in gracePeriodUntil && typeof gracePeriodUntil.seconds === 'number') {
                expiryMillis = gracePeriodUntil.seconds * 1000;
            }
        }
        return typeof expiryMillis === 'number' && Number.isFinite(expiryMillis) ? expiryMillis : null;
    }

    /** Supports Firestore Timestamp, Date object, or Unix milliseconds. */
    public static isGracePeriodActive(user: AppUserInterface | User | null): boolean {
        const expiryMillis = AppUserAccess.getGracePeriodExpiryMs(user);
        return expiryMillis !== null && expiryMillis > Date.now();
    }

    /**
     * Returns true if the user has Pro access.
     * Pro access is granted if they are a Pro user OR have an active grace period.
     */
    public static hasProAccess(user: AppUserInterface | User | null, isAdmin: boolean = false): boolean {
        return AppUserAccess.isProUser(user, isAdmin) || AppUserAccess.isGracePeriodActive(user);
    }

    /**
     * Returns true if the user is a Pro user based on Stripe role, admin status, or legacy isPro flag.
     */
    public static isProUser(user: AppUserInterface | User | null, isAdmin: boolean = false): boolean {
        if (!user) return false;
        const stripeRole = (user as any).stripeRole;
        return stripeRole === 'pro' || isAdmin || (user as any).isPro === true;
    }

    /**
     * Returns true if the user is a Basic subscriber.
     */
    public static isBasicUser(user: User | null): boolean {
        if (!user) return false;
        const stripeRole = (user as any).stripeRole;
        return stripeRole === 'basic';
    }

    /**
     * Returns true if the user has any kind of paid access (Basic or Pro) or is in a Grace Period.
     * Also returns true for admins.
     */
    public static hasPaidAccessUser(user: AppUserInterface | User | null, isAdmin: boolean = false): boolean {
        if (!user) return false;
        if (isAdmin) return true;
        const stripeRole = (user as any).stripeRole;
        const isProFlag = (user as any).isPro === true;
        return stripeRole === 'basic' || stripeRole === 'pro' || isProFlag || AppUserAccess.isGracePeriodActive(user);
    }

}
