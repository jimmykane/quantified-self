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
    createStableProviderIntegerId,
    resolveProviderSerializationIssuesV1,
    type ProviderSerializationIssueV1,
    type ProviderSerializationResultV1,
} from './provider-mapping';

export type CorosWorkoutTypeV1 = 'run' | 'bike';
export type CorosIntensityClassV1 = 'WarmUp' | 'CoolDown' | 'Active' | 'Rest';
export type CorosIntensityTargetUnitV1 =
    | 'PercentOfFtp'
    | 'PercentOfThresholdHr'
    | 'PercentOfThresholdSpeed'
    | 'RangeOfFtp'
    | 'RangeOfCandence'
    | 'RangeOfThresholdHr'
    | 'RangeOfThresholdSpeed';
export type CorosLengthV1 =
    | { Unit: 'Second'; Value: number }
    | { Unit: 'Meter'; Value: number }
    | { Unit: 'EndManually' }
    | { Unit: 'Repetition'; Value: number };
export type CorosIntensityTargetV1 = [] | {
    Unit: CorosIntensityTargetUnitV1;
    Value?: number;
    MinValue?: number;
    MaxValue?: number;
};

export interface CorosTrainingStepV1 {
    Type: 'Step';
    IntensityClass: CorosIntensityClassV1;
    Name: string;
    Description: string;
    Ftp: number;
    ThresholdHr: number;
    ThresholdSpeed: number;
    Length: Exclude<CorosLengthV1, { Unit: 'Repetition' }>;
    IntensityTarget: CorosIntensityTargetV1;
}

export interface CorosTrainingRepeatV1 {
    Type: 'Repetition';
    Length: { Unit: 'Repetition'; Value: number };
    Steps: CorosTrainingStepV1[];
}

export type CorosTrainingNodeV1 = CorosTrainingStepV1 | CorosTrainingRepeatV1;

export interface CorosTrainingWorkoutV1 {
    Description?: string;
    LastModifiedDate: string;
    Title: string;
    Id: number;
    WorkoutDay: string;
    WorkoutType: CorosWorkoutTypeV1;
    Structure: CorosTrainingNodeV1[];
}

export interface CorosTrainingPlanPushDataV1 {
    AthleteId: number;
    StartDate: string;
    EndDate: string;
    Workouts: [CorosTrainingWorkoutV1];
}

export interface SerializeCorosTrainingPlanOptionsV1 {
    athleteId: number;
    sourceWorkoutId: string;
    title: string;
    description?: string;
    localDate: string;
    lastModifiedDate: string;
    allowDegraded: boolean;
}

function requiredText(value: string, label: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new Error(`${label} must not be empty.`);
    return normalized;
}

function positiveCorosInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
        throw new Error(`${label} must be a positive signed 32-bit integer.`);
    }
    return value;
}

function normalizeCorosLocalDateTime(value: string): string {
    const normalized = requiredText(value, 'COROS last-modified datetime');
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(normalized);
    if (!match) {
        throw new Error('COROS last-modified datetime must use YYYY-MM-DDTHH:mm:ss or millisecond precision.');
    }
    normalizeTrainingLocalDate(match[1]);
    const hour = Number(match[2]);
    const minute = Number(match[3]);
    const second = Number(match[4]);
    if (hour > 23 || minute > 59 || second > 59) {
        throw new Error('COROS last-modified datetime contains an invalid time.');
    }
    return normalized;
}

function sportToCoros(sport: ActivityTypes): CorosWorkoutTypeV1 {
    if (sport === ActivityTypes.Running) return 'run';
    if (sport === ActivityTypes.Cycling) return 'bike';
    throw new Error(`Unsupported COROS sport reached after compatibility validation: ${sport}.`);
}

function purposeToCoros(purpose: WorkoutStepPurposeV1): CorosIntensityClassV1 {
    switch (purpose) {
        case 'warmup': return 'WarmUp';
        case 'cooldown': return 'CoolDown';
        case 'recovery':
        case 'rest':
            return 'Rest';
        case 'work':
        case 'other':
            return 'Active';
    }
}

function purposeName(purpose: WorkoutStepPurposeV1): string {
    switch (purpose) {
        case 'warmup': return 'Warm up';
        case 'cooldown': return 'Cool down';
        case 'recovery': return 'Recovery';
        case 'rest': return 'Rest';
        case 'work': return 'Work';
        case 'other': return 'Next';
    }
}

function endingToCoros(ending: WorkoutEndingV1): Exclude<CorosLengthV1, { Unit: 'Repetition' }> {
    switch (ending.kind) {
        case 'time': return { Unit: 'Second', Value: Math.max(1, Math.round(ending.seconds)) };
        case 'distance': return { Unit: 'Meter', Value: Math.max(1, Math.round(ending.meters)) };
        case 'manual': return { Unit: 'EndManually' };
        case 'kilojoules':
        case 'repetitions':
            throw new Error(`Unsupported COROS ending reached after compatibility validation: ${ending.kind}.`);
    }
}

function absoluteRange(target: Exclude<WorkoutTargetV1, { mode: 'relative' }>): {
    minimum: number;
    maximum: number;
} {
    switch (target.kind) {
        case 'heart-rate': return { minimum: target.minimumBpm, maximum: target.maximumBpm };
        case 'power': return { minimum: target.minimumWatts, maximum: target.maximumWatts };
        case 'speed':
            return {
                minimum: target.minimumMetersPerSecond,
                maximum: target.maximumMetersPerSecond,
            };
        case 'cadence': return { minimum: target.minimumRpm, maximum: target.maximumRpm };
    }
}

function frozenRelativeRange(target: Exclude<WorkoutTargetV1, { mode: 'absolute' }>): {
    minimum: number;
    maximum: number;
} {
    const scale = (value: number, percent: number): number => value * percent / 100;
    switch (target.kind) {
        case 'heart-rate':
            return {
                minimum: scale(target.reference.bpm, target.minimumPercent),
                maximum: scale(target.reference.bpm, target.maximumPercent),
            };
        case 'power':
            return {
                minimum: scale(target.reference.watts, target.minimumPercent),
                maximum: scale(target.reference.watts, target.maximumPercent),
            };
        case 'speed':
            return {
                minimum: scale(target.reference.metersPerSecond, target.minimumPercent),
                maximum: scale(target.reference.metersPerSecond, target.maximumPercent),
            };
        case 'cadence':
            return {
                minimum: scale(target.reference.rpm, target.minimumPercent),
                maximum: scale(target.reference.rpm, target.maximumPercent),
            };
    }
}

function rangeTarget(
    unit: CorosIntensityTargetUnitV1,
    minimum: number,
    maximum: number,
): Exclude<CorosIntensityTargetV1, []> {
    return { Unit: unit, MinValue: minimum, MaxValue: maximum };
}

function percentTarget(
    unit: 'PercentOfFtp' | 'PercentOfThresholdHr' | 'PercentOfThresholdSpeed',
    minimum: number,
    maximum: number,
): Exclude<CorosIntensityTargetV1, []> {
    const roundedMinimum = Math.round(minimum);
    const roundedMaximum = Math.round(maximum);
    if (roundedMinimum === roundedMaximum) return { Unit: unit, Value: roundedMinimum };
    return { Unit: unit, MinValue: roundedMinimum, MaxValue: roundedMaximum };
}

function targetToCoros(target: WorkoutTargetV1 | undefined): {
    Ftp: number;
    ThresholdHr: number;
    ThresholdSpeed: number;
    IntensityTarget: CorosIntensityTargetV1;
} {
    if (!target) {
        return { Ftp: 0, ThresholdHr: 0, ThresholdSpeed: 0, IntensityTarget: [] };
    }

    if (target.mode === 'absolute') {
        const range = absoluteRange(target);
        const units = {
            'heart-rate': 'RangeOfThresholdHr',
            power: 'RangeOfFtp',
            speed: 'RangeOfThresholdSpeed',
            cadence: 'RangeOfCandence',
        } as const;
        return {
            Ftp: 0,
            ThresholdHr: 0,
            ThresholdSpeed: 0,
            IntensityTarget: rangeTarget(units[target.kind], range.minimum, range.maximum),
        };
    }

    if (target.kind === 'heart-rate' && target.reference.kind === 'threshold-heart-rate') {
        return {
            Ftp: 0,
            ThresholdHr: target.reference.bpm,
            ThresholdSpeed: 0,
            IntensityTarget: percentTarget(
                'PercentOfThresholdHr',
                target.minimumPercent,
                target.maximumPercent,
            ),
        };
    }
    if (target.kind === 'power' && target.reference.kind === 'functional-threshold-power') {
        return {
            Ftp: target.reference.watts,
            ThresholdHr: 0,
            ThresholdSpeed: 0,
            IntensityTarget: percentTarget('PercentOfFtp', target.minimumPercent, target.maximumPercent),
        };
    }
    if (target.kind === 'speed') {
        return {
            Ftp: 0,
            ThresholdHr: 0,
            ThresholdSpeed: target.reference.metersPerSecond,
            IntensityTarget: percentTarget(
                'PercentOfThresholdSpeed',
                target.minimumPercent,
                target.maximumPercent,
            ),
        };
    }

    const range = frozenRelativeRange(target);
    const unit = target.kind === 'heart-rate'
        ? 'RangeOfThresholdHr'
        : target.kind === 'power'
            ? 'RangeOfFtp'
            : 'RangeOfCandence';
    return {
        Ftp: 0,
        ThresholdHr: 0,
        ThresholdSpeed: 0,
        IntensityTarget: rangeTarget(unit, range.minimum, range.maximum),
    };
}

function stepToCoros(step: CanonicalWorkoutStepV1): CorosTrainingStepV1 {
    return {
        Type: 'Step',
        IntensityClass: purposeToCoros(step.purpose),
        Name: purposeName(step.purpose),
        Description: step.note ?? '',
        ...targetToCoros(step.targets[0]),
        Length: endingToCoros(step.ending),
    };
}

function structureToCorosNodes(structure: WorkoutStructureV1): CorosTrainingNodeV1[] {
    return structure.nodes.map(node => {
        if (node.kind === 'step') return stepToCoros(node);
        return {
            Type: 'Repetition',
            Length: { Unit: 'Repetition', Value: node.count },
            Steps: node.steps.map(stepToCoros),
        };
    });
}

function collectCorosRoundingIssues(
    structure: WorkoutStructureV1,
    issues: ProviderSerializationIssueV1[],
): void {
    const visit = (step: CanonicalWorkoutStepV1, path: string): void => {
        if (
            (step.ending.kind === 'time' && !Number.isInteger(step.ending.seconds))
            || (step.ending.kind === 'distance' && !Number.isInteger(step.ending.meters))
        ) {
            issues.push({
                severity: 'degraded',
                code: 'ending_value_rounded',
                path: `${path}.ending`,
                message: 'COROS requires integer step lengths, so this value will be rounded.',
            });
        }
        const target = step.targets[0];
        if (
            target?.mode === 'relative'
            && (!Number.isInteger(target.minimumPercent) || !Number.isInteger(target.maximumPercent))
        ) {
            issues.push({
                severity: 'degraded',
                code: 'target_percentage_rounded',
                path: `${path}.targets[0]`,
                message: 'COROS requires integer target percentages, so this range will be rounded.',
            });
        }
    };

    structure.nodes.forEach((node, nodeIndex) => {
        if (node.kind === 'step') {
            visit(node, `$.nodes[${nodeIndex}]`);
            return;
        }
        node.steps.forEach((step, stepIndex) => visit(step, `$.nodes[${nodeIndex}].steps[${stepIndex}]`));
    });
}

export function serializeCorosTrainingPlanV1(
    structureValue: unknown,
    options: SerializeCorosTrainingPlanOptionsV1,
): ProviderSerializationResultV1<CorosTrainingPlanPushDataV1> {
    const structure = parseWorkoutStructureV1(structureValue);
    const athleteId = positiveCorosInteger(options.athleteId, 'COROS athlete ID');
    const title = requiredText(options.title, 'COROS workout title');
    const description = options.description?.trim();
    const localDate = normalizeTrainingLocalDate(options.localDate);
    const lastModifiedDate = normalizeCorosLocalDateTime(options.lastModifiedDate);
    const additionalIssues: ProviderSerializationIssueV1[] = [];
    collectCorosRoundingIssues(structure, additionalIssues);

    const resolved = resolveProviderSerializationIssuesV1({
        provider: 'coros',
        structure,
        additionalIssues,
        allowDegraded: options.allowDegraded,
    });
    const workout: CorosTrainingWorkoutV1 = {
        ...(description ? { Description: description } : {}),
        LastModifiedDate: lastModifiedDate,
        Title: title,
        Id: createStableProviderIntegerId('coros', options.sourceWorkoutId),
        WorkoutDay: localDate,
        WorkoutType: sportToCoros(structure.sport),
        Structure: structureToCorosNodes(structure),
    };
    return {
        ...resolved,
        artifact: {
            AthleteId: athleteId,
            StartDate: localDate,
            EndDate: localDate,
            Workouts: [workout],
        },
    };
}
