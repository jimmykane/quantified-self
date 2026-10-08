import { ActivityTypes, DataDuration, DataWeight, type WeightUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings, resolveUnitAwareDisplayStat } from '../../../../shared/unit-aware-display';
import { suuntoGuideWatchTextV1 as watchText, suuntoGuideLiveReadingsV1 as sportLiveFields,
    suuntoGuideMeasuredTargetV1 as measuredTarget, suuntoGuideOptionalReadingsV1, suuntoGuidePoolScreenReadingsV1, isSuuntoGuideManualLapAverageV1,
    type SuuntoGuideReadingTypeV1 as SuuntoGuideReadingType } from '../../../../shared/suunto-guide-presentation';
import {
    parseWorkoutStructureV1,
    allowsEarlyLapV1,
    type WorkoutEndingV1,
    type WorkoutStepPurposeV1,
    type WorkoutStepV1,
    type WorkoutStructureV1,
    type WorkoutTargetV1,
} from '../../../../shared/planned-workout';
import { normalizeTrainingLocalDate } from '../../../../shared/training-plans';
import { parseStrengthWorkoutDetailsV1 } from '../../../../shared/strength-workout';
import {
    createStableProviderExternalId,
    resolveProviderSerializationIssuesV1,
    ProviderWorkoutMappingError,
    type ProviderSerializationIssueV1,
    type ProviderSerializationResultV1,
} from './provider-mapping';

export type SuuntoGuideConditionV1 =
    | { type: 'stepDuration'; value: number }
    | { type: 'stepDistance'; value: number }
    | { type: 'manualLap' }
    | { type: 'or'; conditions: SuuntoGuideConditionV1[] };

export type SuuntoGuideFieldV1 =
    | { type: SuuntoGuideLiveFieldType; title: string }
    | { type: 'pace' | 'power' | 'strokeRate' | 'swolf'; title: string; window: 'manualLap'; aggregate: 'average' }
    | { type: 'distance' | 'duration'; title: string; window: 'step' }
    | { type: 'text'; value: string }
    | { type: 'stepDurationCountdown'; value: number; title: string }
    | { type: 'stepDistanceCountdown'; value: number; title: string }
    | { type: 'targetHeartRate'; min: number; max: number; title: string }
    | { type: 'targetPower'; min: number; max: number; title: string }
    | { type: 'targetSpeed'; min: number; max: number; title: string }
    | { type: 'targetPace'; min: number; max: number; title: string }
    | { type: 'targetCadence'; min: number; max: number; title: string };

export type SuuntoGuideLiveFieldType = 'heartRate' | 'power' | 'pace' | 'speed' | 'cadence';
type GuidePresentation = 'legacy-v2' | 'live-v3' | 'block-pace-v4' | 'sport-screens-v5' | 'early-lap-v6' | 'pool-swolf-v7' | 'pool-screens-v9';
function supportsEarlyLap(presentation: GuidePresentation): boolean {
    return presentation === 'early-lap-v6' || presentation === 'pool-swolf-v7' || presentation === 'pool-screens-v9';
}

export interface SuuntoGuideFieldsStepV1 {
    id?: string;
    type: 'fields';
    title: string;
    fields: SuuntoGuideFieldV1[];
    transitions?: Array<{ condition: SuuntoGuideConditionV1; stepId?: string }>;
    notification?: { title: string; text: string };
    createManualLap?: true;
}

export type SuuntoGuideRepeatFieldsStepV1 = Omit<SuuntoGuideFieldsStepV1, 'id'> & { id?: never };

export interface SuuntoGuideRepeatStepV1 {
    id?: never;
    type: 'repeat';
    times: number;
    steps: SuuntoGuideRepeatFieldsStepV1[];
}

export type SuuntoGuideStepV1 = SuuntoGuideFieldsStepV1 | SuuntoGuideRepeatStepV1;

export type SuuntoGuideActivityIdV1 = 0 | 1 | 2 | 10 | 11 | 15 | 21 | 22 | 23 | 52 | 53 | 57 | 85 | 105 | 106 | 109;

export interface SuuntoGuideJsonV1 {
    type: 'sequence';
    name: string;
    description: string;
    shortDescription: string;
    owner: string;
    url: string;
    activities: SuuntoGuideActivityIdV1[];
    usage: 'workout';
    localDate: string;
    externalId: string;
    steps: SuuntoGuideStepV1[];
}

export interface SerializeSuuntoGuideOptionsV1 {
    name: string;
    description?: string;
    shortDescription?: string;
    owner: string;
    url: string;
    localDate: string;
    sourceWorkoutId: string;
    externalId?: string;
    allowDegraded: boolean;
    /** Private strength-instruction presentation; canonical external loads remain kg. */
    weightUnits?: WeightUnits;
}

const SUUNTO_MINIMUM_SUPPORTED_CHARACTERS = new Set(Array.from(
    "\n !\"#$%&'()*+,-./0123456789:;<=>?ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz|°",
));

const SUUNTO_GUIDE_ACTIVITY_IDS_BY_SPORT: ReadonlyMap<
    ActivityTypes,
    readonly SuuntoGuideActivityIdV1[]
> = new Map([
    [ActivityTypes.Running, [1]],
    [ActivityTypes.TrailRunning, [22]],
    [ActivityTypes.Treadmill, [53]],
    [ActivityTypes.Cycling, [2]],
    [ActivityTypes.MountainBiking, [10]],
    [ActivityTypes.IndoorCycling, [52]],
    // Sports Lib has one canonical E-Biking type while Suunto separates road
    // and mountain e-biking profiles. Recommend the Guide for both.
    [ActivityTypes.EBiking, [105, 106]],
    [ActivityTypes.Handcycle, [109]],
    [ActivityTypes.Swimming, [21]],
    [ActivityTypes.OpenWaterSwimming, [85]],
    [ActivityTypes.Walking, [0]],
    [ActivityTypes.Hiking, [11]],
    [ActivityTypes.Rowing, [15]],
    [ActivityTypes.IndoorRowing, [57]],
    [ActivityTypes.StrengthTraining, [23]],
]);

export function suuntoGuideActivityIdsForSport(
    sport: ActivityTypes,
): SuuntoGuideActivityIdV1[] {
    const activities = SUUNTO_GUIDE_ACTIVITY_IDS_BY_SPORT.get(sport);
    if (!activities) throw new Error(`Unsupported Suunto Guide sport: ${sport}.`);
    return [...activities];
}

function codePointLength(value: string): number {
    return Array.from(value).length;
}

function truncateCodePoints(value: string, maximum: number): string {
    return Array.from(value).slice(0, maximum).join('');
}

function generatedWatchSubtitle(name: string): string {
    if (codePointLength(name) <= 23) return name;
    const prefix = truncateCodePoints(name, 20);
    const boundary = prefix.lastIndexOf(' ');
    return `${(boundary > 0 ? prefix.slice(0, boundary) : prefix).trimEnd()}...`;
}

function usesCharactersOutsideSuuntoMinimum(value: string): boolean {
    return Array.from(value).some(character => !SUUNTO_MINIMUM_SUPPORTED_CHARACTERS.has(character));
}

function normalizedRequiredText(value: string, label: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new Error(`${label} must not be empty.`);
    return normalized;
}

function validateGuideUrl(value: string): string {
    const normalized = normalizedRequiredText(value, 'Suunto Guide URL');
    let url: URL;
    try {
        url = new URL(normalized);
    } catch {
        throw new Error('Suunto Guide URL must be a valid HTTP or HTTPS URL.');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Suunto Guide URL must be a valid HTTP or HTTPS URL.');
    }
    if (normalized.length > 256) throw new Error('Suunto Guide URL must not exceed 256 characters.');
    return normalized;
}

function addTruncationIssue(
    issues: ProviderSerializationIssueV1[],
    path: string,
    label: string,
    maximum: number,
): void {
    issues.push({
        severity: 'degraded',
        code: 'text_truncated',
        path,
        message: `${label} is limited to ${maximum} characters by Suunto.`,
    });
}

function addCharacterSetIssue(
    issues: ProviderSerializationIssueV1[],
    path: string,
    value: string,
    label: string,
): void {
    if (!usesCharactersOutsideSuuntoMinimum(value)) return;
    issues.push({
        severity: 'degraded',
        code: 'device_character_support_unverified',
        path,
        message: `${label} contains characters outside Suunto's guaranteed watch character set and may not render on every device.`,
    });
}

function purposeTitle(purpose: WorkoutStepPurposeV1): string {
    switch (purpose) {
        case 'warmup': return 'Warm up';
        case 'work': return 'Work';
        case 'recovery': return 'Recovery';
        case 'cooldown': return 'Cool down';
        case 'rest': return 'Rest';
        case 'other': return 'Next';
    }
}

function endingFields(ending: WorkoutEndingV1, presentation: GuidePresentation): SuuntoGuideFieldV1[] {
    const title = presentation === 'legacy-v2' ? 'Remaining' : 'Remain';
    switch (ending.kind) {
        case 'time':
            return [{ type: 'stepDurationCountdown', value: ending.seconds, title: presentation === 'pool-screens-v9' ? 'Time rem' : title }];
        case 'distance':
            return [{ type: 'stepDistanceCountdown', value: ending.meters, title: presentation === 'pool-screens-v9' ? 'Dist rem' : title }];
        case 'manual':
            return [];
        case 'kilojoules':
        case 'repetitions':
            throw new Error(`Unsupported Suunto ending reached after compatibility validation: ${ending.kind}.`);
    }
}

function endingCondition(ending: WorkoutEndingV1): SuuntoGuideConditionV1 {
    switch (ending.kind) {
        case 'time':
            return { type: 'stepDuration', value: ending.seconds };
        case 'distance':
            return { type: 'stepDistance', value: ending.meters };
        case 'manual':
            return { type: 'manualLap' };
        case 'kilojoules':
        case 'repetitions':
            throw new Error(`Unsupported Suunto ending reached after compatibility validation: ${ending.kind}.`);
    }
}

function absoluteTargetValues(target: WorkoutTargetV1): { minimum: number; maximum: number } {
    if (target.mode === 'absolute') {
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

function targetToSuunto(target: WorkoutTargetV1, presentation: GuidePresentation): SuuntoGuideFieldV1 {
    const values = absoluteTargetValues(target);
    const legacy = presentation === 'legacy-v2';
    switch (target.kind) {
        case 'heart-rate':
            return {
                type: 'targetHeartRate',
                min: Math.round(values.minimum),
                max: Math.round(values.maximum),
                title: legacy ? 'Target HR' : 'Tgt HR',
            };
        case 'power':
            return { type: 'targetPower', min: values.minimum, max: values.maximum, title: legacy ? 'Tgt power' : 'Tgt W' };
        case 'speed':
            return {
                type: target.presentation === 'pace' ? 'targetPace' : 'targetSpeed',
                min: values.minimum,
                max: values.maximum,
                title: target.presentation === 'pace' ? 'Tgt pace' : legacy ? 'Tgt speed' : 'Tgt spd',
            };
        case 'cadence':
            return {
                type: 'targetCadence',
                min: values.minimum / 60,
                max: values.maximum / 60,
                title: legacy ? 'Tgt cadence' : 'Tgt cad',
            };
    }
}

function collectStepIssues(
    structure: WorkoutStructureV1,
    issues: ProviderSerializationIssueV1[],
): void {
    const visit = (step: WorkoutStepV1, path: string): void => {
        const note = step.note ? watchText(step.note) : '';
        if (codePointLength(note) > 54) {
            addTruncationIssue(issues, `${path}.note`, 'Suunto step text', 54);
        }
        if (codePointLength(note) > 40 && (step.targets.length > 0 || step.ending.kind !== 'manual')) {
            issues.push({
                severity: 'degraded',
                code: 'text_truncated_for_metrics',
                path: `${path}.note`,
                message: 'Suunto cannot show other fields alongside text longer than 40 characters.',
            });
        }
        if (note) addCharacterSetIssue(issues, `${path}.note`, note, 'Step instruction');
        step.targets.forEach((target, targetIndex) => {
            if (target.kind !== 'heart-rate') return;
            const values = absoluteTargetValues(target);
            if (!Number.isInteger(values.minimum) || !Number.isInteger(values.maximum)) {
                issues.push({
                    severity: 'degraded',
                    code: 'heart_rate_rounded',
                    path: `${path}.targets[${targetIndex}]`,
                    message: 'Suunto heart-rate targets require integer bpm values and will be rounded.',
                });
            }
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

function sportReadingField(type: SuuntoGuideReadingType, sport: ActivityTypes, presentation: GuidePresentation): SuuntoGuideFieldV1 {
    if (type === 'distance' || type === 'duration') {
        return { type, title: type === 'distance' ? 'Swum' : 'Elapsed', window: 'step' };
    }
    if (type === 'strokeRate' || type === 'swolf' || ((type === 'pace' || type === 'power') && isSuuntoGuideManualLapAverageV1(type, sport))) {
        // Multi-field titles should be below nine characters. Keep the original
        // v7 label frozen so uncertain older sends retain their exact digest.
        const swolfTitle = presentation === 'pool-screens-v9' ? 'AvgSWOLF' : 'Avg SWOLF';
        return { type, title: type === 'pace' ? 'Avg pace' : type === 'power' ? 'Avg pwr' : type === 'swolf' ? swolfTitle : 'Avg strk',
            window: 'manualLap', aggregate: 'average' };
    }
    const titles: Record<SuuntoGuideLiveFieldType, string> = {
        heartRate: 'HR', power: 'Power', pace: 'Pace', speed: 'Speed', cadence: 'Cadence',
    };
    return { type, title: titles[type] };
}

function notificationText(step: WorkoutStepV1): string {
    // Authored instructions take priority; keep their existing font adaptation
    // and loss review. Generated text is not translated or unit-converted by the watch.
    if (step.note) return truncateCodePoints(watchText(step.note), 54);
    if (step.ending.kind === 'manual') return 'Press lap when ready';
    if (step.ending.kind === 'distance') return allowsEarlyLapV1(step.ending) ? 'Distance limit or press lap' : 'Follow distance countdown';
    if (step.ending.kind === 'time') {
        // Time has no metric/imperial preference. Use the shared Sports Lib
        // display (with seconds), not compactDuration, which omits partial minutes.
        // The shared display omits fractions and, for day-length durations,
        // seconds. Leave those prescriptions to the unchanged numeric countdown.
        if (!Number.isSafeInteger(step.ending.seconds) || step.ending.seconds >= 24 * 60 * 60) {
            return allowsEarlyLapV1(step.ending) ? 'Time limit or press lap' : 'Follow time countdown';
        }
        try {
            const duration = resolveUnitAwareDisplayStat(new DataDuration(step.ending.seconds))?.text;
            const prefix = step.purpose === 'recovery' ? 'Recover for' : step.purpose === 'rest' ? 'Rest for' : 'For';
            const text = duration ? watchText(`${prefix} ${duration}${allowsEarlyLapV1(step.ending) ? ' or press lap' : ''}`) : '';
            // Do not truncate a generated number into a different duration.
            if (text && codePointLength(text) <= 54) return text;
        } catch { /* Optional notification wording must not block a valid countdown. */ }
        return allowsEarlyLapV1(step.ending) ? 'Time limit or press lap' : 'Follow time countdown';
    }
    // Unsupported endings are rejected by endingFields/endingCondition before
    // notification generation; this does not add a provider capability.
    return 'Follow step instructions';
}

function stepToSuunto(step: WorkoutStepV1, sport: ActivityTypes, presentation: GuidePresentation): SuuntoGuideFieldsStepV1 {
    const fields = [
        ...endingFields(step.ending, presentation),
        ...step.targets.map(target => targetToSuunto(target, presentation)),
    ];
    if (step.note) {
        const maximum = fields.length > 0 ? 40 : 54;
        fields.push({ type: 'text', value: truncateCodePoints(watchText(step.note), maximum) });
    }
    if (fields.length === 0 && presentation !== 'pool-screens-v9') fields.push({ type: 'text', value: 'Press lap' });

    if (presentation !== 'legacy-v2' && !fields.some(field => field.type === 'text' && codePointLength(field.value) > 40)) {
        const defaults = sportLiveFields(sport);
        const primary = step.targets.length > 0 ? measuredTarget(step.targets[0], sport) : defaults[0];
        const candidates = [...new Set([...(primary ? [primary] : []), 'heartRate' as const, ...defaults])];
        const titles: Record<SuuntoGuideLiveFieldType, string> = {
            heartRate: 'HR', power: 'Power', pace: 'Pace', speed: 'Speed', cadence: 'Cadence',
        };
        const live: SuuntoGuideFieldV1[] = presentation === 'pool-screens-v9'
            ? suuntoGuidePoolScreenReadingsV1(step).map(type => sportReadingField(type, sport, presentation))
            : ['sport-screens-v5', 'early-lap-v6', 'pool-swolf-v7'].includes(presentation)
            ? suuntoGuideOptionalReadingsV1(step, sport, presentation === 'pool-swolf-v7').map(type => sportReadingField(type, sport, presentation))
            : candidates.slice(0, 5 - fields.length)
            .map(type => type === 'pace' && presentation === 'block-pace-v4'
                ? { type, title: 'Avg pace', window: 'manualLap', aggregate: 'average' }
                : { type, title: titles[type] });
        // The first measured field is the watch's primary reading. Keep the
        // countdown next, and never evict an authored target or instruction.
        fields.unshift(...live.slice(0, 1));
        fields.push(...live.slice(1));
    }

    return {
        id: createStableProviderExternalId('suunto', `node:${step.id}`),
        type: 'fields',
        title: purposeTitle(step.purpose),
        fields,
        transitions: [{ condition: supportsEarlyLap(presentation) && allowsEarlyLapV1(step.ending)
            ? { type: 'or', conditions: [endingCondition(step.ending), { type: 'manualLap' }] } : endingCondition(step.ending) }],
        ...(presentation !== 'legacy-v2' ? { notification: {
            title: purposeTitle(step.purpose),
            text: notificationText(step),
        } } : {}),
    };
}

function structureToSteps(structure: WorkoutStructureV1, presentation: GuidePresentation): SuuntoGuideStepV1[] {
    const steps: SuuntoGuideStepV1[] = structure.nodes.map(node => {
        if (node.kind === 'step') return stepToSuunto(node, structure.sport, presentation);
        return {
            type: 'repeat',
            times: node.count,
            // Suunto rejects id on a repeat and every FieldsStep inside it,
            // even though its schema describes step ids as optional.
            steps: node.steps.map(step => {
                const fieldsStep = stepToSuunto(step, structure.sport, presentation);
                return {
                    type: fieldsStep.type,
                    title: fieldsStep.title,
                    fields: fieldsStep.fields,
                    transitions: fieldsStep.transitions,
                    ...(fieldsStep.notification ? { notification: fieldsStep.notification } : {}),
                };
            }),
        };
    });
    if (presentation !== 'legacy-v2') steps.push({
        type: 'fields', title: 'Complete', fields: [{ type: 'text', value: 'Guide complete' }],
        notification: { title: 'Complete', text: 'Guide complete' },
    });
    // Presentation-only upgrades must not change recorded lap boundaries, even
    // when a rest screen no longer displays its freshly reset lap averages.
    const usesLapAverages = presentation === 'pool-screens-v9' ? structure.nodes.some(node =>
        (node.kind === 'step' ? [node] : node.steps).some(step => suuntoGuideOptionalReadingsV1(step, structure.sport)
            .some(type => isSuuntoGuideManualLapAverageV1(type, structure.sport)))) : steps.some(node =>
        (node.type === 'repeat' ? node.steps : [node]).some(step =>
            step.fields.some(field => 'window' in field && field.window === 'manualLap')));
    if (!['block-pace-v4', 'sport-screens-v5', 'early-lap-v6', 'pool-swolf-v7', 'pool-screens-v9'].includes(presentation)
        || !usesLapAverages) return steps;

    if (supportsEarlyLap(presentation) && structure.nodes.some(node =>
        (node.kind === 'step' ? [node] : node.steps).some(step => allowsEarlyLapV1(step.ending)))) {
        return earlyLapBoundarySteps(structure, presentation);
    }

    // Align all selected manual-lap averages with the
    // prescription, without making another lap after a button-ended step. The
    // first screen starts with recording, so it needs no zero-length opening lap.
    const withBoundary = <T extends SuuntoGuideFieldsStepV1>(step: T, previous: WorkoutEndingV1 | null) => ({
        ...step, ...(previous && previous.kind !== 'manual' ? { createManualLap: true as const } : {}),
    });
    const bounded: SuuntoGuideStepV1[] = [];
    let previous: WorkoutEndingV1 | null = null;
    structure.nodes.forEach((node, index) => {
        const mapped = steps[index];
        if (node.kind === 'step' && mapped.type === 'fields') {
            bounded.push(withBoundary(mapped, previous));
            previous = node.ending;
        } else if (node.kind === 'repeat' && mapped.type === 'repeat') {
            const pass = (prior: WorkoutEndingV1 | null) => mapped.steps.map((step, childIndex) =>
                withBoundary(step, childIndex === 0 ? prior : node.steps[childIndex - 1].ending));
            const last = node.steps[node.steps.length - 1].ending;
            const firstPass = pass(previous);
            const subsequentPass = pass(last);
            // Native repeats reuse one child definition. Only split off the
            // first pass when its incoming lap boundary differs from the wrap.
            // Two bounded repeat containers avoid expanding up to 100 passes.
            if (node.count > 1 && firstPass[0].createManualLap !== subsequentPass[0].createManualLap) {
                bounded.push({ type: 'repeat', times: 1, steps: firstPass },
                    { type: 'repeat', times: node.count - 1, steps: subsequentPass });
            } else bounded.push({ type: 'repeat', times: node.count, steps: firstPass });
            previous = last;
        }
    });
    // Close the final automatic block in the recorded laps. A lap-ended final
    // block is already closed by the button; completion adds no timed exercise.
    bounded.push(withBoundary(steps[steps.length - 1] as SuuntoGuideFieldsStepV1, previous));
    return bounded;
}

/** Branch on the exit event so a button-created lap is never closed a second time.
 * Repeat occurrences become private standalone screens because Suunto forbids IDs
 * within repeats. Canonical IDs/counts stay unchanged; the provider limit fails closed. */
function earlyLapBoundarySteps(structure: WorkoutStructureV1, presentation: GuidePresentation): SuuntoGuideFieldsStepV1[] {
    const authored = structure.nodes.flatMap(node => node.kind === 'step' ? [node]
        : Array.from({ length: node.count }, () => node.steps).flat());
    const id = (index: number, button = false) => `qs-boundary-${index}-${button ? 'lap' : 'auto'}`;
    const output: SuuntoGuideFieldsStepV1[] = [];
    for (let index = 0; index <= authored.length; index++) {
        const previous = authored[index - 1]?.ending;
        const step = authored[index];
        const base: SuuntoGuideFieldsStepV1 = step ? stepToSuunto(step, structure.sport, presentation) : {
            type: 'fields', title: 'Complete', fields: [{ type: 'text', value: 'Guide complete' }],
            notification: { title: 'Complete', text: 'Guide complete' },
        };
        if (step) base.transitions = allowsEarlyLapV1(step.ending) ? [
            // First matching transition wins, including simultaneous limit + button.
            { condition: { type: 'manualLap' }, stepId: id(index + 1, true) },
            { condition: { type: 'or', conditions: [endingCondition(step.ending), { type: 'manualLap' }] }, stepId: id(index + 1) },
        ] : [{ condition: endingCondition(step.ending), stepId: id(index + 1) }];
        output.push({ ...base, id: id(index),
            ...(previous && previous.kind !== 'manual' ? { createManualLap: true } : {}) });
        if (previous && allowsEarlyLapV1(previous)) output.push({ ...base, id: id(index, true) });
    }
    return output;
}

/** Recovery only: reproduce immutable sport-screen v5 payloads. */
export function serializeSuuntoGuideV5ForRecovery(structureValue: unknown, options: SerializeSuuntoGuideOptionsV1) {
    return serializeGuide(structureValue, options, 'sport-screens-v5');
}

/** Recovery only: preserve exact early-Lap v6 screens before pool SWOLF. */
export function serializeSuuntoGuideV6ForRecovery(structureValue: unknown, options: SerializeSuuntoGuideOptionsV1) {
    return serializeGuide(structureValue, options, 'early-lap-v6');
}

/** Recovery only: reproduce the exact pool SWOLF v7 payload and lap policy. */
export function serializeSuuntoGuideV7ForRecovery(structureValue: unknown, options: SerializeSuuntoGuideOptionsV1) {
    return serializeGuide(structureValue, options, 'pool-swolf-v7');
}

export function serializeSuuntoGuideJsonV1(
    structureValue: unknown,
    options: SerializeSuuntoGuideOptionsV1,
): ProviderSerializationResultV1<SuuntoGuideJsonV1> {
    return serializeGuide(structureValue, options, 'pool-screens-v9');
}

/** Recovery only: preserve Training 01's exact average-pace screens and lap boundaries. */
export function serializeSuuntoGuideV4ForRecovery(
    structureValue: unknown, options: SerializeSuuntoGuideOptionsV1,
): ProviderSerializationResultV1<SuuntoGuideJsonV1> {
    return serializeGuide(structureValue, options, 'block-pace-v4');
}

/** Recovery only: keep current-reading v3 JSON behind its immutable attempt digest. */
export function serializeSuuntoGuideV3ForRecovery(
    structureValue: unknown, options: SerializeSuuntoGuideOptionsV1,
): ProviderSerializationResultV1<SuuntoGuideJsonV1> {
    return serializeGuide(structureValue, options, 'live-v3');
}

/** Recovery only: reproduce the exact payload behind an immutable v2 attempt digest. */
export function serializeSuuntoGuideV2ForRecovery(
    structureValue: unknown, options: SerializeSuuntoGuideOptionsV1,
): ProviderSerializationResultV1<SuuntoGuideJsonV1> {
    return serializeGuide(structureValue, options, 'legacy-v2');
}

function serializeGuide(structureValue: unknown, options: SerializeSuuntoGuideOptionsV1,
    presentation: GuidePresentation): ProviderSerializationResultV1<SuuntoGuideJsonV1> {
    const structure = parseWorkoutStructureV1(structureValue);
    // Select after strict parsing, once. Non-pool payloads keep their exact v7 presentation.
    if (presentation === 'pool-screens-v9' && structure.sport !== ActivityTypes.Swimming) presentation = 'pool-swolf-v7';
    const early = structure.nodes.some(node => (node.kind === 'step' ? [node] : node.steps)
        .some(step => allowsEarlyLapV1(step.ending)));
    if (early && !supportsEarlyLap(presentation)) throw new ProviderWorkoutMappingError('suunto', 'unsupported', [{
        severity: 'unsupported', code: 'unsupported_ending', path: '$.nodes',
        message: 'Historical Guide mappings cannot express early Lap permission.',
    }]);
    const rawName = normalizedRequiredText(options.name, 'Suunto Guide name');
    const rawDescription = normalizedRequiredText(options.description ?? rawName, 'Suunto Guide description');
    const name = watchText(rawName);
    // The generated subtitle is display metadata, not authored workout instructions.
    // Explicit subtitles still require approval if their content must be shortened.
    const shortDescription = options.shortDescription === undefined ? generatedWatchSubtitle(name)
        : watchText(normalizedRequiredText(options.shortDescription, 'Suunto Guide short description'));
    const rawOwner = normalizedRequiredText(options.owner, 'Suunto Guide owner');
    const url = validateGuideUrl(options.url);
    const localDate = normalizeTrainingLocalDate(options.localDate);
    const externalId = options.externalId
        ? normalizedRequiredText(options.externalId, 'Suunto Guide external ID')
        : createStableProviderExternalId('suunto', options.sourceWorkoutId);
    if (externalId.length > 64) throw new Error('Suunto Guide external ID must not exceed 64 characters.');

    const additionalIssues: ProviderSerializationIssueV1[] = [];
    if (codePointLength(name) > 60) addTruncationIssue(additionalIssues, '$.name', 'Suunto Guide name', 60);
    if (codePointLength(rawDescription) > 256) {
        addTruncationIssue(additionalIssues, '$.description', 'Suunto Guide description', 256);
    }
    if (codePointLength(shortDescription) > 23) {
        addTruncationIssue(additionalIssues, '$.shortDescription', 'Suunto Guide short description', 23);
    }
    if (codePointLength(rawOwner) > 64) addTruncationIssue(additionalIssues, '$.owner', 'Suunto Guide owner', 64);
    addCharacterSetIssue(additionalIssues, '$.name', name, 'Workout title');
    // Description is app-only. A derived subtitle must not duplicate its title warning.
    if (options.shortDescription !== undefined) {
        addCharacterSetIssue(additionalIssues, '$.shortDescription', shortDescription, 'Watch subtitle');
    }
    addCharacterSetIssue(additionalIssues, '$.owner', rawOwner, 'Guide owner');
    collectStepIssues(structure, additionalIssues);

    const resolved = resolveProviderSerializationIssuesV1({
        provider: 'suunto',
        structure,
        additionalIssues,
        allowDegraded: options.allowDegraded,
    });
    const artifact: SuuntoGuideJsonV1 = {
        type: 'sequence',
        name: truncateCodePoints(name, 60),
        description: truncateCodePoints(rawDescription, 256),
        shortDescription: truncateCodePoints(shortDescription, 23),
        owner: truncateCodePoints(rawOwner, 64),
        url,
        activities: suuntoGuideActivityIdsForSport(structure.sport),
        usage: 'workout',
        localDate,
        externalId,
        steps: structureToSteps(structure, presentation),
    };

    return { ...resolved, artifact };
}

/** A Gym Guide is an instruction sequence, not native rep/load tracking. */
export function serializeSuuntoStrengthGuideV1(
    detailsValue: unknown,
    options: SerializeSuuntoGuideOptionsV1,
): ProviderSerializationResultV1<SuuntoGuideJsonV1> {
    return serializeStrength(detailsValue, options, 'sport-screens-v5', true);
}

/** Recovery only; v5–v7 strength instructions used literal canonical kilogram values. */
export function serializeSuuntoStrengthGuideV7ForRecovery(
    detailsValue: unknown, options: SerializeSuuntoGuideOptionsV1,
): ProviderSerializationResultV1<SuuntoGuideJsonV1> {
    return serializeStrength(detailsValue, options, 'sport-screens-v5');
}

/** Recovery only; v4 strength remains the exact current-HR instruction sequence. */
export function serializeSuuntoStrengthGuideV4ForRecovery(
    detailsValue: unknown, options: SerializeSuuntoGuideOptionsV1,
): ProviderSerializationResultV1<SuuntoGuideJsonV1> {
    return serializeStrength(detailsValue, options, 'block-pace-v4');
}

/** Recovery only; strength keeps its existing current-HR instruction screens. */
export function serializeSuuntoStrengthGuideV3ForRecovery(
    detailsValue: unknown, options: SerializeSuuntoGuideOptionsV1,
): ProviderSerializationResultV1<SuuntoGuideJsonV1> {
    return serializeStrength(detailsValue, options, 'live-v3');
}

/** Recovery only; never used to author a new delivery. */
export function serializeSuuntoStrengthGuideV2ForRecovery(
    detailsValue: unknown, options: SerializeSuuntoGuideOptionsV1,
): ProviderSerializationResultV1<SuuntoGuideJsonV1> {
    return serializeStrength(detailsValue, options, 'legacy-v2');
}

function serializeStrength(detailsValue: unknown, options: SerializeSuuntoGuideOptionsV1,
    presentation: GuidePresentation, unitAwareWeight = false): ProviderSerializationResultV1<SuuntoGuideJsonV1> {
    const details = parseStrengthWorkoutDetailsV1(detailsValue);
    const unitSettings = normalizeUserUnitSettings({ weightUnits: options.weightUnits });
    const nodes: WorkoutStepV1[] = [];
    details.exercises.forEach(exercise => exercise.sets.forEach((set, index) => {
        const load = set.externalLoadKg === undefined ? null : unitAwareWeight
            ? resolveUnitAwareDisplayStat(new DataWeight(set.externalLoadKg), unitSettings)!.text
            : `${set.externalLoadKg} kg`;
        const label = `${exercise.name} - set ${index + 1} - ${set.ending.kind === 'repetitions'
            ? `${set.ending.repetitions} reps` : `${set.ending.seconds} seconds`}${load === null ? '' : ` - ${load}`}`;
        nodes.push({ kind: 'step', id: `set-${set.id}`, purpose: 'work',
            ending: set.ending.kind === 'repetitions' ? { kind: 'manual' } : set.ending,
            targets: [], note: label });
        if (set.restAfterSeconds !== undefined) {
            nodes.push({ kind: 'step', id: `rest-${set.id}`, purpose: 'rest',
                ending: { kind: 'time', seconds: set.restAfterSeconds }, targets: [] });
        }
    }));
    const base = serializeGuide({ version: 1, sport: ActivityTypes.StrengthTraining, nodes }, {
        ...options, allowDegraded: true,
    }, presentation);
    const manualIssue: ProviderSerializationIssueV1 = {
        severity: 'degraded', code: 'manual_strength_repetitions', path: '$.steps',
        message: 'Suunto Gym Guides show exercise/set instructions and require manual transitions for repetitions; they do not count reps or track load natively.',
    };
    const issues = [manualIssue, ...base.issues];
    // Manual rep transitions are the normal Gym Guide model, disclosed during Send/Enable sync.
    // Additional losses (for example shortened exercise instructions) still require review.
    const requiresApproval = base.level === 'degraded';
    if (requiresApproval && !options.allowDegraded) {
        throw new ProviderWorkoutMappingError('suunto', 'degradation-confirmation-required', issues);
    }
    return { ...base, level: 'degraded', issues, requiresApproval };
}
