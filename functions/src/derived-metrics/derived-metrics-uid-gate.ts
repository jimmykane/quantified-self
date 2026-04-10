const DERIVED_METRICS_UID_ALLOWLIST = new Set<string>([
    'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
]);

/**
 * Optional runtime gate for safely constraining derived-metrics scheduling to
 * specific users while validating behavior in production.
 */
export function isDerivedMetricsUidAllowed(uid: string): boolean {
    return DERIVED_METRICS_UID_ALLOWLIST.has(uid);
}

export function getDerivedMetricsUidAllowlist(): ReadonlySet<string> {
    return DERIVED_METRICS_UID_ALLOWLIST;
}
