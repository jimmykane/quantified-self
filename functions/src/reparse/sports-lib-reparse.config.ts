export const SPORTS_LIB_REPARSE_TARGET_VERSION = '11.0.1';

export const SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS = {
    enabled: true,
    // Higher defaults improve migration throughput while still allowing bounded scans.
    scanLimit: 1200,
    enqueueLimit: 800,
    uidAllowlist: ['xcsAolLDDTWTgtRN9eYF3lW2YKL2'],
} as const;
