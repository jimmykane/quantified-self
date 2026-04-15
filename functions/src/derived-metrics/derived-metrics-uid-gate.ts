const DERIVED_METRICS_UID_ALLOWLIST = new Set<string>();

/**
 * Optional runtime gate for safely constraining derived-metrics scheduling to
 * specific users while validating behavior in production.
 * An empty allowlist means the gate is disabled and all non-empty UIDs are
 * accepted.
 */
export function isDerivedMetricsUidAllowed(uid: string): boolean {
    const normalizedUid = `${uid || ''}`.trim();
    if (!normalizedUid) {
        return false;
    }
    if (!DERIVED_METRICS_UID_ALLOWLIST.size) {
        return true;
    }
    return DERIVED_METRICS_UID_ALLOWLIST.has(normalizedUid);
}

export function getDerivedMetricsUidAllowlist(): ReadonlySet<string> {
    return DERIVED_METRICS_UID_ALLOWLIST;
}
