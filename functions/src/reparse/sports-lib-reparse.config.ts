import { SPORTS_LIB_VERSION } from '../shared/sports-lib-version.node';

export const SPORTS_LIB_REPARSE_TARGET_VERSION = SPORTS_LIB_VERSION;
export const SPORTS_LIB_REPARSE_HEAVY_DURATION_THRESHOLD_MS = 24 * 60 * 60 * 1000;
export const SPORTS_LIB_REPARSE_AUTO_TOO_HEAVY_DURATION_MS = 72 * 60 * 60 * 1000;
export const SPORTS_LIB_REPARSE_MAX_RAW_SOURCE_BYTES = 30 * 1024 * 1024;
export const SPORTS_LIB_REPARSE_MAX_RAW_SOURCE_BYTES_LABEL = '30MB';
export const SPORTS_LIB_REPARSE_NORMAL_SAFE_RUNTIME_BUDGET_MS = 25 * 60 * 1000;
export const SPORTS_LIB_REPARSE_HEAVY_SAFE_RUNTIME_BUDGET_MS = 15 * 60 * 1000;

export const SPORTS_LIB_REPARSE_PROCESSING_TIERS = {
    Normal: 'normal',
    Heavy: 'heavy',
} as const;

export type SportsLibReparseProcessingTier = typeof SPORTS_LIB_REPARSE_PROCESSING_TIERS[keyof typeof SPORTS_LIB_REPARSE_PROCESSING_TIERS];

export const SPORTS_LIB_REPARSE_HEAVY_REASONS = {
    Duration: 'duration_gte_24h',
    ManualAdmin: 'manual_admin',
} as const;

export type SportsLibReparseHeavyReason = typeof SPORTS_LIB_REPARSE_HEAVY_REASONS[keyof typeof SPORTS_LIB_REPARSE_HEAVY_REASONS];

export const SPORTS_LIB_REPARSE_FAILURE_REASONS = {
    ReparseFailed: 'REPARSE_FAILED',
    TooHeavyForAutoReparse: 'TOO_HEAVY_FOR_AUTO_REPARSE',
} as const;

export type SportsLibReparseFailureReason = typeof SPORTS_LIB_REPARSE_FAILURE_REASONS[keyof typeof SPORTS_LIB_REPARSE_FAILURE_REASONS];

export const SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS = {
    enabled: false,
    // Higher defaults improve migration throughput while still allowing bounded scans.
    scanLimit: 1200,
    enqueueLimit: 1200,
    uidAllowlist: [],
} as const;

export const SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS = {
    enabled: false,
    scanLimit: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.scanLimit,
    enqueueLimit: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.enqueueLimit,
    uidAllowlist: [],
} as const;
