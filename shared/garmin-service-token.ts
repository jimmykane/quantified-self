export const GARMIN_ROUTE_SEND_REQUIRED_PERMISSIONS = ['COURSE_IMPORT'] as const;

function normalizeNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function toTimestampMs(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (value instanceof Date) {
        return value.getTime();
    }

    if (typeof (value as { toDate?: unknown } | null)?.toDate === 'function') {
        const date = (value as { toDate: () => Date }).toDate();
        return Number.isFinite(date.getTime()) ? date.getTime() : 0;
    }

    if (
        typeof (value as { seconds?: unknown } | null)?.seconds === 'number'
        && typeof (value as { nanoseconds?: unknown } | null)?.nanoseconds === 'number'
    ) {
        const timestamp = value as { seconds: number; nanoseconds: number };
        return (timestamp.seconds * 1000) + Math.round(timestamp.nanoseconds / 1000000);
    }

    if (typeof value === 'string') {
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date.getTime() : 0;
    }

    return 0;
}

export function getGarminProviderUserIdFromTokenLike(tokenLike: unknown): string | null {
    if (!tokenLike || typeof tokenLike !== 'object' || Array.isArray(tokenLike)) {
        return null;
    }

    return normalizeNonEmptyString((tokenLike as { userID?: unknown }).userID);
}

export function getGarminPermissionsFromTokenLike(tokenLike: unknown): string[] {
    if (!tokenLike || typeof tokenLike !== 'object' || Array.isArray(tokenLike)) {
        return [];
    }

    const permissions = (tokenLike as { permissions?: unknown }).permissions;
    if (!Array.isArray(permissions)) {
        return [];
    }

    return Array.from(new Set(
        permissions
            .map(permission => normalizeNonEmptyString(permission))
            .filter((permission): permission is string => permission !== null),
    ));
}

export function getMissingGarminPermissionsForTokenLike(
    tokenLike: unknown,
    requiredPermissions: readonly string[],
): string[] {
    if (requiredPermissions.length === 0) {
        return [];
    }

    const grantedPermissions = new Set(getGarminPermissionsFromTokenLike(tokenLike));
    return requiredPermissions.filter(permission => !grantedPermissions.has(permission));
}

export function getConnectedGarminProviderUserIds(tokenLikes: readonly unknown[]): string[] {
    return Array.from(new Set(
        tokenLikes
            .map(tokenLike => getGarminProviderUserIdFromTokenLike(tokenLike))
            .filter((providerUserId): providerUserId is string => providerUserId !== null),
    ));
}

export function hasConnectedGarminToken(tokenLikes: readonly unknown[]): boolean {
    return getConnectedGarminProviderUserIds(tokenLikes).length > 0;
}

export function selectPreferredGarminTokenLike<T>(
    tokenLikes: readonly T[],
    requiredPermissions: readonly string[],
): T | null {
    const candidates = tokenLikes
        .map((tokenLike, index) => ({
            tokenLike,
            index,
            providerUserId: getGarminProviderUserIdFromTokenLike(tokenLike),
            missingPermissions: getMissingGarminPermissionsForTokenLike(tokenLike, requiredPermissions),
            permissionsLoaded: Array.isArray((tokenLike as { permissions?: unknown } | null)?.permissions),
            createdAtMs: toTimestampMs((tokenLike as { dateCreated?: unknown } | null)?.dateCreated),
        }))
        .filter((candidate): candidate is {
            tokenLike: T;
            index: number;
            providerUserId: string;
            missingPermissions: string[];
            permissionsLoaded: boolean;
            createdAtMs: number;
        } => candidate.providerUserId !== null)
        .sort((left, right) => (
            left.missingPermissions.length - right.missingPermissions.length
            || Number(right.permissionsLoaded) - Number(left.permissionsLoaded)
            || right.createdAtMs - left.createdAtMs
            || left.index - right.index
        ));

    return candidates[0]?.tokenLike || null;
}
