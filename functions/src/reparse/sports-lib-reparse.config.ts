export const SPORTS_LIB_REPARSE_TARGET_VERSION = '15.0.4';
export const SPORTS_LIB_REPARSE_HEAVY_DURATION_THRESHOLD_MS = 32 * 60 * 60 * 1000;

export const SPORTS_LIB_REPARSE_PROCESSING_TIERS = {
    Normal: 'normal',
    Heavy: 'heavy',
} as const;

export type SportsLibReparseProcessingTier = typeof SPORTS_LIB_REPARSE_PROCESSING_TIERS[keyof typeof SPORTS_LIB_REPARSE_PROCESSING_TIERS];

export const SPORTS_LIB_REPARSE_HEAVY_REASONS = {
    Duration: 'duration_gt_32h',
    ManualAdmin: 'manual_admin',
} as const;

export type SportsLibReparseHeavyReason = typeof SPORTS_LIB_REPARSE_HEAVY_REASONS[keyof typeof SPORTS_LIB_REPARSE_HEAVY_REASONS];

export const SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS = {
    enabled: false,
    // Higher defaults improve migration throughput while still allowing bounded scans.
    scanLimit: 1200,
    enqueueLimit: 1200,
    uidAllowlist: [],
} as const;
