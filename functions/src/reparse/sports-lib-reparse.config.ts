import { SPORTS_LIB_VERSION } from '../shared/sports-lib-version.node';
import { validateSportsLibReparseTargetUid } from '../../../shared/admin-queue-stats';

export { validateSportsLibReparseTargetUid };
export type { SportsLibReparseTargetUidValidation } from '../../../shared/admin-queue-stats';

export const SPORTS_LIB_REPARSE_TARGET_VERSION = SPORTS_LIB_VERSION;
export const SPORTS_LIB_REPARSE_HEAVY_DURATION_THRESHOLD_MS = 24 * 60 * 60 * 1000;
// Duration-heavy jobs are bounded by the heavy worker's runtime budget, not by
// the event's recorded duration.
export const SPORTS_LIB_REPARSE_AUTO_TOO_HEAVY_DURATION_MS: number | null = null;
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

export const SPORTS_LIB_REPARSE_RUNTIME_SETTINGS_FIELD = 'runtimeSettings';
export const SPORTS_LIB_REPARSE_CHECKPOINT_PATH = 'systemJobs/sportsLibReparse';

export interface ResolvedSportsLibReparseRuntimeSettings {
    enabled: boolean;
    scanLimit: number;
    enqueueLimit: number;
    targetUid: string | null;
    uidAllowlist: Set<string> | null;
    source: 'firestore' | 'defaults';
    configurationValid: boolean;
    updatedAt: unknown;
    updatedBy: string | null;
}

function resolveDefaultUidAllowlist(): {
    configurationValid: boolean;
    targetUid: string | null;
    uidAllowlist: Set<string> | null;
} {
    const normalizedUIDs: string[] = [];
    for (const value of SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.uidAllowlist) {
        const validation = validateSportsLibReparseTargetUid(value);
        if (!validation.valid || !validation.targetUid) {
            return { configurationValid: false, targetUid: null, uidAllowlist: null };
        }
        normalizedUIDs.push(validation.targetUid);
    }
    const uidAllowlist = normalizedUIDs.length > 0 ? new Set(normalizedUIDs) : null;
    return {
        configurationValid: true,
        targetUid: normalizedUIDs.length === 1 ? normalizedUIDs[0] : null,
        uidAllowlist,
    };
}

export function resolveSportsLibReparseRuntimeSettings(
    checkpointData: unknown,
): ResolvedSportsLibReparseRuntimeSettings {
    const checkpointRecord = checkpointData && typeof checkpointData === 'object' && !Array.isArray(checkpointData)
        ? checkpointData as Record<string, unknown>
        : undefined;
    const hasStoredSettings = checkpointRecord !== undefined
        && Object.prototype.hasOwnProperty.call(checkpointRecord, SPORTS_LIB_REPARSE_RUNTIME_SETTINGS_FIELD);

    if (!hasStoredSettings) {
        const defaultAllowlist = resolveDefaultUidAllowlist();
        return {
            enabled: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.enabled && defaultAllowlist.configurationValid,
            scanLimit: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.scanLimit,
            enqueueLimit: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.enqueueLimit,
            targetUid: defaultAllowlist.targetUid,
            uidAllowlist: defaultAllowlist.uidAllowlist,
            source: 'defaults',
            configurationValid: defaultAllowlist.configurationValid,
            updatedAt: null,
            updatedBy: null,
        };
    }

    const rawSettings = checkpointRecord?.[SPORTS_LIB_REPARSE_RUNTIME_SETTINGS_FIELD];
    const storedSettings = rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)
        ? rawSettings as Record<string, unknown>
        : null;
    const targetValidation = validateSportsLibReparseTargetUid(storedSettings?.targetUid);
    const configurationValid = storedSettings !== null
        && typeof storedSettings.enabled === 'boolean'
        && Object.prototype.hasOwnProperty.call(storedSettings, 'targetUid')
        && targetValidation.valid;
    const targetUid = targetValidation.valid ? targetValidation.targetUid : null;

    return {
        // A malformed persisted setting must never accidentally enable a global scan.
        enabled: configurationValid && storedSettings?.enabled === true,
        scanLimit: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.scanLimit,
        enqueueLimit: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.enqueueLimit,
        targetUid,
        uidAllowlist: configurationValid && targetUid ? new Set([targetUid]) : null,
        source: 'firestore',
        configurationValid,
        updatedAt: storedSettings?.updatedAt ?? null,
        updatedBy: typeof storedSettings?.updatedBy === 'string' ? storedSettings.updatedBy : null,
    };
}

export const SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS = {
    enabled: false,
    scanLimit: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.scanLimit,
    enqueueLimit: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.enqueueLimit,
    uidAllowlist: [],
} as const;
