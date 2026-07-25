import { SPORTS_LIB_VERSION } from '../shared/sports-lib-version.node';

export const SPORTS_LIB_REPARSE_TARGET_VERSION = SPORTS_LIB_VERSION;
export const SPORTS_LIB_REPARSE_HEAVY_DURATION_THRESHOLD_MS = 24 * 60 * 60 * 1000;

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

export const SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS = {
    enabled: true,
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
