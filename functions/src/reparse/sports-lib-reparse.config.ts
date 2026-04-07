export const SPORTS_LIB_REPARSE_TARGET_VERSION = '11.0.3';

export const SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS = {
    enabled: true,
    // Higher defaults improve migration throughput while still allowing bounded scans.
    scanLimit: 1200,
    enqueueLimit: 1200,
    uidAllowlist: [],
} as const;
