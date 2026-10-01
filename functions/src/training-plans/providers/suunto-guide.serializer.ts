import { ActivityTypes, DataDuration } from '@sports-alliance/sports-lib';
import { resolveUnitAwareDisplayStat } from '../../../../shared/unit-aware-display';
import {
    parseWorkoutStructureV1,
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
    | { type: 'manualLap' };

export type SuuntoGuideFieldV1 =
    | { type: SuuntoGuideLiveFieldType; title: string }
    | { type: 'text'; value: string }
    | { type: 'stepDurationCountdown'; value: number; title: string }
    | { type: 'stepDistanceCountdown'; value: number; title: string }
    | { type: 'targetHeartRate'; min: number; max: number; title: string }
    | { type: 'targetPower'; min: number; max: number; title: string }
    | { type: 'targetSpeed'; min: number; max: number; title: string }
    | { type: 'targetPace'; min: number; max: number; title: string }
    | { type: 'targetCadence'; min: number; max: number; title: string };

export type SuuntoGuideLiveFieldType = 'heartRate' | 'power' | 'pace' | 'speed' | 'cadence';
type GuidePresentation = 'legacy-v2' | 'live-v3';

export interface SuuntoGuideFieldsStepV1 {
    id?: string;
    type: 'fields';
    title: string;
    fields: SuuntoGuideFieldV1[];
    transitions?: Array<{ condition: SuuntoGuideConditionV1 }>;
    notification?: { title: string; text: string };
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

/** Cosmetic watch-font substitutions only. Never transliterate letters, strip
 * unknown characters, or apply these changes to ownership/identity fields. */
function watchText(value: string): string {
    return value.replace(/[\u2010-\u2015]/g, '-')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/\u2026/g, '...')
        .replace(/[\u00a0\u202f]/g, ' ');
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
            return [{ type: 'stepDurationCountdown', value: ending.seconds, title }];
        case 'distance':
            return [{ type: 'stepDistanceCountdown', value: ending.meters, title }];
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

function sportLiveFields(sport: ActivityTypes): SuuntoGuideLiveFieldType[] {
    if (sport === ActivityTypes.StrengthTraining) return ['heartRate'];
    if ([ActivityTypes.Cycling, ActivityTypes.MountainBiking, ActivityTypes.IndoorCycling,
        ActivityTypes.EBiking, ActivityTypes.Handcycle].includes(sport)) return ['power', 'heartRate', 'speed'];
    return ['pace', 'heartRate'];
}

function measuredTarget(target: WorkoutTargetV1, sport: ActivityTypes): SuuntoGuideLiveFieldType | null {
    // The partner schema documents power/cadence sensors for running/cycling,
    // not swimming stroke rate or rowing strokes. Preserve authored target
    // fields, but do not invent a sensor mapping for other sports.
    const hasPowerCadence = sportLiveFields(sport)[0] === 'power'
        || [ActivityTypes.Running, ActivityTypes.TrailRunning, ActivityTypes.Treadmill].includes(sport);
    switch (target.kind) {
        case 'heart-rate': return 'heartRate';
        case 'power': return hasPowerCadence ? 'power' : null;
        case 'speed': return target.presentation === 'pace' ? 'pace' : 'speed';
        case 'cadence': return hasPowerCadence ? 'cadence' : null;
    }
}

function notificationText(step: WorkoutStepV1): string {
    // Authored instructions take priority; keep their existing font adaptation
    // and loss review. Generated text is not translated or unit-converted by the watch.
    if (step.note) return truncateCodePoints(watchText(step.note), 54);
    if (step.ending.kind === 'manual') return 'Press lap when ready';
    if (step.ending.kind === 'distance') return 'Follow distance countdown';
    if (step.ending.kind === 'time') {
        // Time has no metric/imperial preference. Use the shared Sports Lib
        // display (with seconds), not compactDuration, which omits partial minutes.
        // The shared display omits fractions and, for day-length durations,
        // seconds. Leave those prescriptions to the unchanged numeric countdown.
        if (!Number.isSafeInteger(step.ending.seconds) || step.ending.seconds >= 24 * 60 * 60) {
            return 'Follow time countdown';
        }
        try {
            const duration = resolveUnitAwareDisplayStat(new DataDuration(step.ending.seconds))?.text;
            const prefix = step.purpose === 'recovery' ? 'Recover for' : step.purpose === 'rest' ? 'Rest for' : 'For';
            const text = duration ? watchText(`${prefix} ${duration}`) : '';
            // Do not truncate a generated number into a different duration.
            if (text && codePointLength(text) <= 54) return text;
        } catch { /* Optional notification wording must not block a valid countdown. */ }
        return 'Follow time countdown';
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
    if (fields.length === 0) fields.push({ type: 'text', value: 'Press lap' });

    if (presentation === 'live-v3' && !fields.some(field => field.type === 'text' && codePointLength(field.value) > 40)) {
        const defaults = sportLiveFields(sport);
        const primary = step.targets.length > 0 ? measuredTarget(step.targets[0], sport) : defaults[0];
        const candidates = [...new Set([...(primary ? [primary] : []), 'heartRate' as const, ...defaults])];
        const titles: Record<SuuntoGuideLiveFieldType, string> = {
            heartRate: 'HR', power: 'Power', pace: 'Pace', speed: 'Speed', cadence: 'Cadence',
        };
        const live: SuuntoGuideFieldV1[] = candidates.slice(0, 5 - fields.length)
            .map(type => ({ type, title: titles[type] }));
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
        transitions: [{ condition: endingCondition(step.ending) }],
        ...(presentation === 'live-v3' ? { notification: {
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
    if (presentation === 'live-v3') steps.push({
        type: 'fields', title: 'Complete', fields: [{ type: 'text', value: 'Guide complete' }],
        notification: { title: 'Complete', text: 'Guide complete' },
    });
    return steps;
}

export function serializeSuuntoGuideJsonV1(
    structureValue: unknown,
    options: SerializeSuuntoGuideOptionsV1,
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
    return serializeStrength(detailsValue, options, 'live-v3');
}

/** Recovery only; never used to author a new delivery. */
export function serializeSuuntoStrengthGuideV2ForRecovery(
    detailsValue: unknown, options: SerializeSuuntoGuideOptionsV1,
): ProviderSerializationResultV1<SuuntoGuideJsonV1> {
    return serializeStrength(detailsValue, options, 'legacy-v2');
}

function serializeStrength(detailsValue: unknown, options: SerializeSuuntoGuideOptionsV1,
    presentation: GuidePresentation): ProviderSerializationResultV1<SuuntoGuideJsonV1> {
    const details = parseStrengthWorkoutDetailsV1(detailsValue);
    const nodes: WorkoutStepV1[] = [];
    details.exercises.forEach(exercise => exercise.sets.forEach((set, index) => {
        const label = `${exercise.name} - set ${index + 1} - ${set.ending.kind === 'repetitions'
            ? `${set.ending.repetitions} reps` : `${set.ending.seconds} seconds`}${set.externalLoadKg === undefined
            ? '' : ` - ${set.externalLoadKg} kg`}`;
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
