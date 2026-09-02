import { ActivityTypes } from '@sports-alliance/sports-lib';
import {
    parseWorkoutStructureV1,
    type WorkoutEndingV1,
    type WorkoutStepPurposeV1,
    type WorkoutStepV1 as CanonicalWorkoutStepV1,
    type WorkoutStructureV1,
    type WorkoutTargetV1,
} from '../../../../shared/planned-workout';
import { normalizeTrainingLocalDate } from '../../../../shared/training-plans';
import {
    resolveProviderSerializationIssuesV1,
    type ProviderSerializationIssueV1,
    type ProviderSerializationResultV1,
} from './provider-mapping';

export type GarminWorkoutSportV1 = 'RUNNING' | 'CYCLING';
export type GarminWorkoutIntensityV1 = 'REST' | 'WARMUP' | 'COOLDOWN' | 'RECOVERY' | 'ACTIVE';
export type GarminWorkoutDurationTypeV1 = 'TIME' | 'DISTANCE' | 'OPEN' | 'FIXED_REST';
export type GarminWorkoutTargetTypeV1 = 'SPEED' | 'PACE' | 'HEART_RATE' | 'CADENCE' | 'POWER' | 'OPEN';

interface GarminTargetFieldsV1 {
    targetType: GarminWorkoutTargetTypeV1;
    targetValue: null;
    targetValueLow: number | null;
    targetValueHigh: number | null;
    targetValueType: null;
}

interface GarminSecondaryTargetFieldsV1 {
    secondaryTargetType: Exclude<GarminWorkoutTargetTypeV1, 'OPEN'> | null;
    secondaryTargetValue: null;
    secondaryTargetValueLow: number | null;
    secondaryTargetValueHigh: number | null;
    secondaryTargetValueType: null;
}

export interface GarminWorkoutStepV1 extends GarminTargetFieldsV1, GarminSecondaryTargetFieldsV1 {
    type: 'WorkoutStep';
    stepOrder: number;
    intensity: GarminWorkoutIntensityV1;
    description: string;
    durationType: GarminWorkoutDurationTypeV1;
    durationValue: number | null;
    durationValueType: 'METER' | null;
}

export interface GarminWorkoutRepeatStepV1 {
    type: 'WorkoutRepeatStep';
    stepOrder: number;
    repeatType: 'REPEAT_UNTIL_STEPS_CMPLT';
    repeatValue: number;
    skipLastRestStep: false;
    steps: GarminWorkoutStepV1[];
}

export type GarminWorkoutNodeV1 = GarminWorkoutStepV1 | GarminWorkoutRepeatStepV1;

export interface GarminWorkoutPayloadV1 {
    ownerId?: number;
    workoutName: string;
    description: string;
    sport: GarminWorkoutSportV1;
    workoutProvider: 'Quantified Self';
    workoutSourceId: 'Quantified Self';
    isSessionTransitionEnabled: false;
    segments: [{
        segmentOrder: 1;
        sport: GarminWorkoutSportV1;
        poolLength: null;
        poolLengthUnit: null;
        steps: GarminWorkoutNodeV1[];
    }];
}

export interface GarminWorkoutSchedulePayloadV1 {
    workoutId: number;
    date: string;
}

export interface SerializeGarminWorkoutOptionsV1 {
    name: string;
    description?: string;
    ownerId?: number;
    allowDegraded: boolean;
}

function codePointLength(value: string): number {
    return Array.from(value).length;
}

function truncateCodePoints(value: string, maximum: number): string {
    return Array.from(value).slice(0, maximum).join('');
}

function requiredText(value: string, label: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new Error(`${label} must not be empty.`);
    return normalized;
}

function optionalPositiveSafeInteger(value: number | undefined, label: string): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive safe integer.`);
    }
    return value;
}

function sportToGarmin(sport: ActivityTypes): GarminWorkoutSportV1 {
    if (sport === ActivityTypes.Running) return 'RUNNING';
    if (sport === ActivityTypes.Cycling) return 'CYCLING';
    throw new Error(`Unsupported Garmin sport reached after compatibility validation: ${sport}.`);
}

function purposeToGarmin(purpose: WorkoutStepPurposeV1): GarminWorkoutIntensityV1 {
    switch (purpose) {
        case 'warmup': return 'WARMUP';
        case 'recovery': return 'RECOVERY';
        case 'cooldown': return 'COOLDOWN';
        case 'rest': return 'REST';
        case 'work':
        case 'other':
            return 'ACTIVE';
    }
}

function endingToGarmin(
    ending: WorkoutEndingV1,
    purpose: WorkoutStepPurposeV1,
): Pick<GarminWorkoutStepV1, 'durationType' | 'durationValue' | 'durationValueType'> {
    switch (ending.kind) {
        case 'time':
            return {
                durationType: purpose === 'rest' ? 'FIXED_REST' : 'TIME',
                durationValue: ending.seconds,
                durationValueType: null,
            };
        case 'distance':
            return {
                durationType: 'DISTANCE',
                durationValue: ending.meters,
                durationValueType: 'METER',
            };
        case 'manual':
            return { durationType: 'OPEN', durationValue: null, durationValueType: null };
        case 'kilojoules':
        case 'repetitions':
            throw new Error(`Unsupported Garmin ending reached after compatibility validation: ${ending.kind}.`);
    }
}

function absoluteTargetRange(target: WorkoutTargetV1): {
    type: Exclude<GarminWorkoutTargetTypeV1, 'OPEN'>;
    low: number;
    high: number;
} {
    const scale = (value: number, percent: number): number => value * percent / 100;
    if (target.mode === 'absolute') {
        switch (target.kind) {
            case 'heart-rate':
                return { type: 'HEART_RATE', low: target.minimumBpm, high: target.maximumBpm };
            case 'power':
                return { type: 'POWER', low: target.minimumWatts, high: target.maximumWatts };
            case 'speed':
                return {
                    type: target.presentation === 'pace' ? 'PACE' : 'SPEED',
                    low: target.minimumMetersPerSecond,
                    high: target.maximumMetersPerSecond,
                };
            case 'cadence':
                return { type: 'CADENCE', low: target.minimumRpm, high: target.maximumRpm };
        }
    }

    switch (target.kind) {
        case 'heart-rate':
            return {
                type: 'HEART_RATE',
                low: scale(target.reference.bpm, target.minimumPercent),
                high: scale(target.reference.bpm, target.maximumPercent),
            };
        case 'power':
            return {
                type: 'POWER',
                low: scale(target.reference.watts, target.minimumPercent),
                high: scale(target.reference.watts, target.maximumPercent),
            };
        case 'speed':
            return {
                type: target.presentation === 'pace' ? 'PACE' : 'SPEED',
                low: scale(target.reference.metersPerSecond, target.minimumPercent),
                high: scale(target.reference.metersPerSecond, target.maximumPercent),
            };
        case 'cadence':
            return {
                type: 'CADENCE',
                low: scale(target.reference.rpm, target.minimumPercent),
                high: scale(target.reference.rpm, target.maximumPercent),
            };
    }
}

function primaryTargetFields(target: WorkoutTargetV1 | undefined): GarminTargetFieldsV1 {
    if (!target) {
        return {
            targetType: 'OPEN',
            targetValue: null,
            targetValueLow: null,
            targetValueHigh: null,
            targetValueType: null,
        };
    }
    const range = absoluteTargetRange(target);
    return {
        targetType: range.type,
        targetValue: null,
        targetValueLow: range.low,
        targetValueHigh: range.high,
        targetValueType: null,
    };
}

function secondaryTargetFields(target: WorkoutTargetV1 | undefined): GarminSecondaryTargetFieldsV1 {
    if (!target) {
        return {
            secondaryTargetType: null,
            secondaryTargetValue: null,
            secondaryTargetValueLow: null,
            secondaryTargetValueHigh: null,
            secondaryTargetValueType: null,
        };
    }
    const range = absoluteTargetRange(target);
    return {
        secondaryTargetType: range.type,
        secondaryTargetValue: null,
        secondaryTargetValueLow: range.low,
        secondaryTargetValueHigh: range.high,
        secondaryTargetValueType: null,
    };
}

function stepToGarmin(step: CanonicalWorkoutStepV1, stepOrder: number): GarminWorkoutStepV1 {
    return {
        type: 'WorkoutStep',
        stepOrder,
        intensity: purposeToGarmin(step.purpose),
        description: step.note ?? '',
        ...endingToGarmin(step.ending, step.purpose),
        ...primaryTargetFields(step.targets[0]),
        ...secondaryTargetFields(step.targets[1]),
    };
}

function structureToGarminNodes(structure: WorkoutStructureV1): GarminWorkoutNodeV1[] {
    let stepOrder = 0;
    return structure.nodes.map(node => {
        stepOrder += 1;
        if (node.kind === 'step') return stepToGarmin(node, stepOrder);
        const repeatOrder = stepOrder;
        const steps = node.steps.map(step => {
            stepOrder += 1;
            return stepToGarmin(step, stepOrder);
        });
        return {
            type: 'WorkoutRepeatStep',
            stepOrder: repeatOrder,
            repeatType: 'REPEAT_UNTIL_STEPS_CMPLT',
            repeatValue: node.count,
            skipLastRestStep: false,
            steps,
        };
    });
}

export function serializeGarminWorkoutV1(
    structureValue: unknown,
    options: SerializeGarminWorkoutOptionsV1,
): ProviderSerializationResultV1<GarminWorkoutPayloadV1> {
    const structure = parseWorkoutStructureV1(structureValue);
    const workoutName = requiredText(options.name, 'Garmin workout name');
    const rawDescription = options.description?.trim() ?? '';
    const ownerId = optionalPositiveSafeInteger(options.ownerId, 'Garmin owner ID');
    const additionalIssues: ProviderSerializationIssueV1[] = [];
    if (codePointLength(rawDescription) > 1024) {
        additionalIssues.push({
            severity: 'degraded',
            code: 'description_truncated',
            path: '$.description',
            message: 'Garmin workout descriptions are limited to 1024 characters.',
        });
    }

    const resolved = resolveProviderSerializationIssuesV1({
        provider: 'garmin',
        structure,
        additionalIssues,
        allowDegraded: options.allowDegraded,
    });
    const sport = sportToGarmin(structure.sport);
    const artifact: GarminWorkoutPayloadV1 = {
        ...(ownerId === undefined ? {} : { ownerId }),
        workoutName,
        description: truncateCodePoints(rawDescription, 1024),
        sport,
        workoutProvider: 'Quantified Self',
        workoutSourceId: 'Quantified Self',
        isSessionTransitionEnabled: false,
        segments: [{
            segmentOrder: 1,
            sport,
            poolLength: null,
            poolLengthUnit: null,
            steps: structureToGarminNodes(structure),
        }],
    };
    return { ...resolved, artifact };
}

export function serializeGarminWorkoutScheduleV1(
    workoutId: number,
    localDate: string,
): GarminWorkoutSchedulePayloadV1 {
    if (!Number.isSafeInteger(workoutId) || workoutId <= 0) {
        throw new Error('Garmin workout ID must be a positive safe integer.');
    }
    return { workoutId, date: normalizeTrainingLocalDate(localDate) };
}
