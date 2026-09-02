import { createHash } from 'crypto';
import {
    assessPlannedWorkoutProviderMappingV1,
    type PlannedWorkoutProviderId,
    type PlannedWorkoutProviderMappingIssueV1,
    type PlannedWorkoutProviderMappingLevel,
} from '../../../../shared/planned-workout-providers';

export interface ProviderSerializationIssueV1 {
    severity: Exclude<PlannedWorkoutProviderMappingLevel, 'exact'>;
    code: string;
    path: string;
    message: string;
}

export interface ProviderSerializationResultV1<T> {
    provider: PlannedWorkoutProviderId;
    level: PlannedWorkoutProviderMappingLevel;
    issues: ProviderSerializationIssueV1[];
    artifact: T;
}

export class ProviderWorkoutMappingError extends Error {
    readonly code: 'unsupported' | 'degradation-confirmation-required';
    readonly provider: PlannedWorkoutProviderId;
    readonly issues: ProviderSerializationIssueV1[];

    constructor(
        provider: PlannedWorkoutProviderId,
        code: ProviderWorkoutMappingError['code'],
        issues: ProviderSerializationIssueV1[],
    ) {
        const reason = code === 'unsupported'
            ? 'cannot be represented'
            : 'requires explicit degradation approval';
        super(`${provider} workout ${reason}: ${issues.map(issue => `${issue.path}: ${issue.message}`).join('; ')}`);
        this.name = 'ProviderWorkoutMappingError';
        this.code = code;
        this.provider = provider;
        this.issues = issues;
    }
}

export function createStableProviderExternalId(
    provider: PlannedWorkoutProviderId,
    sourceWorkoutId: string,
): string {
    if (sourceWorkoutId.trim().length === 0) {
        throw new Error('A non-empty source workout ID is required.');
    }
    const digest = createHash('sha256')
        .update(`${provider}\u0000${sourceWorkoutId}`, 'utf8')
        .digest('base64url');
    return `qs-${provider}-${digest}`;
}

/**
 * Produces an opaque positive signed 32-bit integer for provider contracts
 * that declare partner-owned IDs as `int`. The provider remains part of the
 * digest namespace and the original Quantified Self ID is never disclosed.
 */
export function createStableProviderIntegerId(
    provider: PlannedWorkoutProviderId,
    sourceId: string,
): number {
    if (sourceId.trim().length === 0) {
        throw new Error('A non-empty source ID is required.');
    }
    const digest = createHash('sha256')
        .update(`${provider}\u0000integer\u0000${sourceId}`, 'utf8')
        .digest();
    const value = digest.readUInt32BE(0) & 0x7fffffff;
    return value === 0 ? 1 : value;
}

export function buildProviderSerializationResultV1<T>(params: {
    provider: PlannedWorkoutProviderId;
    structure: unknown;
    artifact: T;
    additionalIssues?: readonly ProviderSerializationIssueV1[];
    allowDegraded: boolean;
}): ProviderSerializationResultV1<T> {
    const resolved = resolveProviderSerializationIssuesV1({
        provider: params.provider,
        structure: params.structure,
        additionalIssues: params.additionalIssues,
        allowDegraded: params.allowDegraded,
    });

    return {
        provider: params.provider,
        level: resolved.level,
        issues: resolved.issues,
        artifact: params.artifact,
    };
}

export function resolveProviderSerializationIssuesV1(params: {
    provider: PlannedWorkoutProviderId;
    structure: unknown;
    additionalIssues?: readonly ProviderSerializationIssueV1[];
    allowDegraded: boolean;
}): Pick<ProviderSerializationResultV1<never>, 'provider' | 'level' | 'issues'> {
    const assessment = assessPlannedWorkoutProviderMappingV1(params.provider, params.structure);
    const issues: ProviderSerializationIssueV1[] = [
        ...assessment.issues.map((issue: PlannedWorkoutProviderMappingIssueV1) => ({ ...issue })),
        ...(params.additionalIssues ?? []),
    ];
    const level: PlannedWorkoutProviderMappingLevel = issues.some(issue => issue.severity === 'unsupported')
        ? 'unsupported'
        : issues.some(issue => issue.severity === 'degraded')
            ? 'degraded'
            : 'exact';

    if (level === 'unsupported') {
        throw new ProviderWorkoutMappingError(params.provider, 'unsupported', issues);
    }
    if (level === 'degraded' && !params.allowDegraded) {
        throw new ProviderWorkoutMappingError(params.provider, 'degradation-confirmation-required', issues);
    }

    return {
        provider: params.provider,
        level,
        issues,
    };
}
