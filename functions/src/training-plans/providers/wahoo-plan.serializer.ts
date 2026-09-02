import { ActivityTypes } from '@sports-alliance/sports-lib';
import {
    parseWorkoutStructureV1,
    type WorkoutEndingV1,
    type WorkoutStepPurposeV1,
    type WorkoutStepV1,
    type WorkoutStructureV1,
    type WorkoutTargetV1,
} from '../../../../shared/planned-workout';
import {
    resolveProviderSerializationIssuesV1,
    type ProviderSerializationIssueV1,
    type ProviderSerializationResultV1,
} from './provider-mapping';

export type WahooWorkoutLocationV1 = 'indoor' | 'outdoor';
export type WahooPlanTargetTypeV1 =
    | 'rpm'
    | 'watts'
    | 'hr'
    | 'speed'
    | 'ftp'
    | 'threshold_hr'
    | 'max_hr'
    | 'threshold_speed';

export interface WahooPlanTargetV1 {
    type: WahooPlanTargetTypeV1;
    low: number;
    high: number;
}

export interface WahooPlanIntervalV1 {
    name?: string;
    exit_trigger_type: 'time' | 'distance' | 'kj2' | 'repeat';
    exit_trigger_value: number;
    intensity_type?: 'active' | 'wu' | 'cd' | 'recover' | 'rest';
    targets?: WahooPlanTargetV1[];
    intervals?: WahooPlanIntervalV1[];
}

export interface WahooPlanJsonV1 {
    header: {
        name: string;
        version: '1.0.0';
        description?: string;
        workout_type_family: 0 | 1;
        workout_type_location: 0 | 1;
        ftp?: number;
        threshold_hr?: number;
        max_hr?: number;
        threshold_speed?: number;
    };
    intervals: WahooPlanIntervalV1[];
}

export interface SerializeWahooPlanOptionsV1 {
    name: string;
    description?: string;
    location: WahooWorkoutLocationV1;
    allowDegraded: boolean;
}

type WahooReferenceHeaderKey = 'ftp' | 'threshold_hr' | 'max_hr' | 'threshold_speed';

interface WahooMappingContext {
    headerReferences: Partial<Record<WahooReferenceHeaderKey, number>>;
    rawHeaderReferences: Partial<Record<WahooReferenceHeaderKey, number>>;
}

function codePointLength(value: string): number {
    return Array.from(value).length;
}

function truncateCodePoints(value: string, maximum: number): string {
    return Array.from(value).slice(0, maximum).join('');
}

function assertNonEmpty(value: string, label: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new Error(`${label} must not be empty.`);
    return normalized;
}

function purposeToIntensity(purpose: WorkoutStepPurposeV1): WahooPlanIntervalV1['intensity_type'] {
    switch (purpose) {
        case 'warmup': return 'wu';
        case 'recovery': return 'recover';
        case 'cooldown': return 'cd';
        case 'rest': return 'rest';
        case 'work':
        case 'other':
            return 'active';
    }
}

function endingToTrigger(ending: WorkoutEndingV1): Pick<
WahooPlanIntervalV1,
'exit_trigger_type' | 'exit_trigger_value'
> {
    switch (ending.kind) {
        case 'time':
            return { exit_trigger_type: 'time', exit_trigger_value: ending.seconds };
        case 'distance':
            return { exit_trigger_type: 'distance', exit_trigger_value: ending.meters };
        case 'kilojoules':
            return { exit_trigger_type: 'kj2', exit_trigger_value: ending.kilojoules };
        case 'repetitions':
        case 'manual':
            throw new Error(`Unsupported Wahoo ending reached after compatibility validation: ${ending.kind}.`);
    }
}

function nativeReference(target: WorkoutTargetV1): { key: WahooReferenceHeaderKey; value: number } | null {
    if (target.mode !== 'relative') return null;
    switch (target.kind) {
        case 'heart-rate':
            return target.reference.kind === 'max-heart-rate'
                ? { key: 'max_hr', value: target.reference.bpm }
                : { key: 'threshold_hr', value: target.reference.bpm };
        case 'power':
            return target.reference.kind === 'functional-threshold-power'
                ? { key: 'ftp', value: target.reference.watts }
                : null;
        case 'speed':
            return { key: 'threshold_speed', value: target.reference.metersPerSecond };
        case 'cadence':
            return null;
    }
}

function normalizedNativeReferenceValue(reference: { key: WahooReferenceHeaderKey; value: number }): number {
    return reference.key === 'threshold_speed' ? reference.value : Math.round(reference.value);
}

function freezeRelativeTarget(target: Exclude<WorkoutTargetV1, { mode: 'absolute' }>): WahooPlanTargetV1 {
    const scale = (value: number, percent: number): number => value * percent / 100;
    switch (target.kind) {
        case 'heart-rate':
            return {
                type: 'hr',
                low: scale(target.reference.bpm, target.minimumPercent),
                high: scale(target.reference.bpm, target.maximumPercent),
            };
        case 'power':
            return {
                type: 'watts',
                low: scale(target.reference.watts, target.minimumPercent),
                high: scale(target.reference.watts, target.maximumPercent),
            };
        case 'speed':
            return {
                type: 'speed',
                low: scale(target.reference.metersPerSecond, target.minimumPercent),
                high: scale(target.reference.metersPerSecond, target.maximumPercent),
            };
        case 'cadence':
            return {
                type: 'rpm',
                low: scale(target.reference.rpm, target.minimumPercent),
                high: scale(target.reference.rpm, target.maximumPercent),
            };
    }
}

function targetToWahoo(target: WorkoutTargetV1, context: WahooMappingContext): WahooPlanTargetV1 {
    if (target.mode === 'absolute') {
        switch (target.kind) {
            case 'heart-rate':
                return { type: 'hr', low: target.minimumBpm, high: target.maximumBpm };
            case 'power':
                return { type: 'watts', low: target.minimumWatts, high: target.maximumWatts };
            case 'speed':
                return {
                    type: 'speed',
                    low: target.minimumMetersPerSecond,
                    high: target.maximumMetersPerSecond,
                };
            case 'cadence':
                return { type: 'rpm', low: target.minimumRpm, high: target.maximumRpm };
        }
    }

    const reference = nativeReference(target);
    if (reference === null) return freezeRelativeTarget(target);
    const existingReference = context.rawHeaderReferences[reference.key];
    if (existingReference !== undefined && existingReference !== reference.value) {
        return freezeRelativeTarget(target);
    }
    context.rawHeaderReferences[reference.key] = reference.value;
    context.headerReferences[reference.key] = normalizedNativeReferenceValue(reference);
    return {
        type: reference.key,
        low: target.minimumPercent / 100,
        high: target.maximumPercent / 100,
    };
}

function collectReferenceRoundingIssues(
    structure: WorkoutStructureV1,
    issues: ProviderSerializationIssueV1[],
): void {
    const visit = (step: WorkoutStepV1, path: string): void => {
        step.targets.forEach((target, targetIndex) => {
            const reference = nativeReference(target);
            if (!reference || reference.key === 'threshold_speed' || Number.isInteger(reference.value)) return;
            issues.push({
                severity: 'degraded',
                code: 'relative_reference_rounded',
                path: `${path}.targets[${targetIndex}].reference`,
                message: 'Wahoo requires an integer FTP or heart-rate header reference, so this snapshot will be rounded.',
            });
        });
    };
    structure.nodes.forEach((node, nodeIndex) => {
        if (node.kind === 'step') {
            visit(node, `$.nodes[${nodeIndex}]`);
            return;
        }
        node.steps.forEach((step, stepIndex) => visit(step, `$.nodes[${nodeIndex}].steps[${stepIndex}]`));
    });
}

function stepToWahoo(step: WorkoutStepV1, context: WahooMappingContext): WahooPlanIntervalV1 {
    const targets = step.targets.map(target => targetToWahoo(target, context));
    return {
        ...(step.note ? { name: step.note } : {}),
        ...endingToTrigger(step.ending),
        intensity_type: purposeToIntensity(step.purpose),
        ...(targets.length > 0 ? { targets } : {}),
    };
}

function structureToIntervals(
    structure: WorkoutStructureV1,
    context: WahooMappingContext,
): WahooPlanIntervalV1[] {
    return structure.nodes.map(node => {
        if (node.kind === 'step') return stepToWahoo(node, context);
        return {
            exit_trigger_type: 'repeat',
            // Wahoo encodes repeats after the first pass; canonical count is total passes.
            exit_trigger_value: node.count - 1,
            intervals: node.steps.map(step => stepToWahoo(step, context)),
        };
    });
}

export function serializeWahooPlanJsonV1(
    structureValue: unknown,
    options: SerializeWahooPlanOptionsV1,
): ProviderSerializationResultV1<WahooPlanJsonV1> {
    const structure = parseWorkoutStructureV1(structureValue);
    const name = assertNonEmpty(options.name, 'Wahoo plan name');
    const normalizedDescription = options.description?.trim();
    const additionalIssues: ProviderSerializationIssueV1[] = [];
    if (normalizedDescription && codePointLength(normalizedDescription) > 5000) {
        additionalIssues.push({
            severity: 'degraded',
            code: 'description_truncated',
            path: '$.header.description',
            message: 'Wahoo descriptions are limited to 5000 characters.',
        });
    }
    collectReferenceRoundingIssues(structure, additionalIssues);

    const resolved = resolveProviderSerializationIssuesV1({
        provider: 'wahoo',
        structure,
        additionalIssues,
        allowDegraded: options.allowDegraded,
    });
    const context: WahooMappingContext = { headerReferences: {}, rawHeaderReferences: {} };
    const intervals = structureToIntervals(structure, context);
    const workoutTypeFamily: 0 | 1 = structure.sport === ActivityTypes.Cycling ? 0 : 1;
    const workoutTypeLocation: 0 | 1 = options.location === 'indoor' ? 0 : 1;
    const artifact: WahooPlanJsonV1 = {
        header: {
            name,
            version: '1.0.0',
            ...(normalizedDescription
                ? { description: truncateCodePoints(normalizedDescription, 5000) }
                : {}),
            workout_type_family: workoutTypeFamily,
            workout_type_location: workoutTypeLocation,
            ...context.headerReferences,
        },
        intervals,
    };

    return { ...resolved, artifact };
}
