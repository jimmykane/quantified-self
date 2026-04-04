const DERIVED_METRICS_UID_ALLOWLIST_ENV_KEY = 'DERIVED_METRICS_UID_ALLOWLIST';

function parseUidAllowlist(rawAllowlist: string | undefined): Set<string> | null {
    if (!rawAllowlist) {
        return null;
    }

    const parsedUids = rawAllowlist
        .split(/[,\n]/)
        .map((uid) => uid.trim())
        .filter((uid) => uid.length > 0);

    if (parsedUids.length === 0) {
        return null;
    }

    return new Set(parsedUids);
}

/**
 * Optional runtime gate for safely constraining derived-metrics scheduling to
 * specific users while validating behavior in production.
 */
export function isDerivedMetricsUidAllowed(uid: string): boolean {
    const allowlist = parseUidAllowlist(process.env[DERIVED_METRICS_UID_ALLOWLIST_ENV_KEY]);
    if (!allowlist) {
        return true;
    }
    return allowlist.has(uid);
}

export function getDerivedMetricsUidAllowlistEnvKey(): string {
    return DERIVED_METRICS_UID_ALLOWLIST_ENV_KEY;
}

