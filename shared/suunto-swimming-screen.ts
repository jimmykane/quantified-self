import { ActivityTypes, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { allowsEarlyLapV1, formatWorkoutEndingV1, type WorkoutStepV1, type WorkoutStructureV1 } from './planned-workout';
import { isSuuntoGuideManualLapAverageV1, suuntoGuideOptionalReadingsV1, suuntoGuideWatchTextV1 } from './suunto-guide-presentation';
import { normalizeSuuntoSwimmingGuideSettings, normalizeSuuntoSwimmingGuideSettingsForRecovery, isSuuntoPreviousLapField, type SuuntoSwimWorkField,
  type SuuntoSwimRestField } from './suunto-swimming-guide-settings';

/** Private Guide presentation only. Not a canonical recipe or MCP field. */
export type SuuntoSwimmingField =
  | { type: 'pace'; title: string; window: 'manualLap'; aggregate: 'average'; windowOffset: -1 }
  | { type: 'duration' | 'strokes'; title: string; window: 'manualLap'; windowOffset: -1 }
  | { type: 'heartRate' | 'power' | 'pace' | 'speed' | 'cadence'; title: string }
  | { type: 'pace' | 'power' | 'strokeRate' | 'swolf'; title: string; window: 'manualLap'; aggregate: 'average' }
  | { type: 'distance'; title: string; window: 'step' | 'workout' | 'manualLap' }
  | { type: 'strokes'; title: string; window: 'workout' | 'manualLap' }
  | { type: 'duration'; title: string; window: 'step' }
  | { type: 'text'; value: string }
  | { type: 'stepDurationCountdown' | 'stepDistanceCountdown'; value: number; title: string }
  | { type: 'targetHeartRate' | 'targetPower' | 'targetSpeed' | 'targetPace' | 'targetCadence'; min: number; max: number; title: string };
export type SuuntoSwimmingOccurrence = { step: WorkoutStepV1; interval?: number; total: number };
type Selection = SuuntoSwimWorkField | SuuntoSwimRestField;
export interface SuuntoSwimmingChoiceResult {
  field: Selection;
  state: 'included' | 'heading' | 'omitted';
  reason: string;
}
export interface SuuntoSwimmingScreen {
  title: string;
  fields: SuuntoSwimmingField[];
  choices: SuuntoSwimmingChoiceResult[];
}
export const SUUNTO_SWIMMING_EXPANDED_SCREEN_LIMIT = 1000;

/** Bound before expanding. Work occurrences, not recorded laps or pool lengths. */
export function suuntoSwimmingOccurrences(structure: WorkoutStructureV1): SuuntoSwimmingOccurrence[] | null {
  const count = structure.nodes.reduce((sum, node) => sum + (node.kind === 'step' ? 1 : node.count * node.steps.length), 0);
  if (count > SUUNTO_SWIMMING_EXPANDED_SCREEN_LIMIT) return null;
  // Match the frozen v11 graph: Complete consumes one screen; an early-Lap
  // boundary has a second incoming branch only when that graph uses averages.
  const usesAverages = structure.nodes.some(node => (node.kind === 'step' ? [node] : node.steps).some(step =>
    suuntoGuideOptionalReadingsV1(step, structure.sport).some(type => isSuuntoGuideManualLapAverageV1(type, structure.sport))));
  const branches = usesAverages ? structure.nodes.reduce((sum, node) => sum + (node.kind === 'step'
    ? Number(allowsEarlyLapV1(node.ending)) : node.count * node.steps.filter(step => allowsEarlyLapV1(step.ending)).length), 0) : 0;
  if (count + 1 + branches > SUUNTO_SWIMMING_EXPANDED_SCREEN_LIMIT) return null;
  const steps = structure.nodes.flatMap(node => node.kind === 'step' ? [node]
    : Array.from({ length: node.count }, () => node.steps).flat());
  const total = steps.filter(step => step.purpose === 'work').length;
  let interval = 0;
  return steps.map((step, index) => {
    if (step.purpose === 'work') interval++;
    return { step, total, ...(step.purpose === 'work' || step.purpose === 'rest' && steps[index - 1]?.purpose === 'work' ? { interval } : {}) };
  });
}

/** Short distance context, never the ending instruction or an invented measurement. */
function plannedDistance(occurrence: SuuntoSwimmingOccurrence | undefined, units?: UserUnitSettingsInterface): string | null {
  if (occurrence?.step.purpose !== 'work' || occurrence.step.ending.kind !== 'distance') return null;
  const { meters } = occurrence.step.ending;
  // Omit "or Lap": the context describes prescribed distance, not how to end it.
  return suuntoGuideWatchTextV1(formatWorkoutEndingV1({ kind: 'distance', meters }, units));
}

/** One allocator for backend payloads and the app's per-step availability report.
 * Required fields come from the frozen serializer. The app can pass shape-only
 * required fields: allocation depends on types/text, never target values. */
export function planSuuntoSwimmingScreen(title: string, baseFields: readonly SuuntoSwimmingField[], sport: ActivityTypes,
  rawSettings: unknown, occurrence?: SuuntoSwimmingOccurrence, previous?: SuuntoSwimmingOccurrence,
  next?: SuuntoSwimmingOccurrence, units?: UserUnitSettingsInterface, previousLapReadings = false): SuuntoSwimmingScreen {
  const settings = previousLapReadings ? normalizeSuuntoSwimmingGuideSettings(rawSettings)
    : normalizeSuuntoSwimmingGuideSettingsForRecovery(rawSettings);
  const rest = occurrence?.step.purpose === 'rest' || title === 'Rest';
  const choices: SuuntoSwimmingChoiceResult[] = [];
  const selections = rest ? settings.restFields : settings.workFields;
  // Generated manual reminders are not authored instructions and need no cell.
  const required = baseFields.filter(field => field.type.endsWith('Countdown') || field.type.startsWith('target')
    || field.type === 'text' && (!occurrence || !!occurrence.step.note));
  const longNote = required.some(field => field.type === 'text' && Array.from(field.value).length > 40);
  let heading = title;
  const numbered = occurrence?.interval ? `${rest ? 'Rest' : 'Work'} ${occurrence.interval}/${occurrence.total}` : null;
  if (selections.includes('interval') && numbered && Array.from(numbered).length <= 13) heading = numbered;
  const fields: SuuntoSwimmingField[] = required.filter(field => field.type.endsWith('Countdown')).map(field => ({ ...field,
    title: rest ? 'Rest rem' : field.type === 'stepDistanceCountdown' ? 'Dist rem' : 'Time rem' }));
  const key = (field: SuuntoSwimmingField): string => field.type === 'text' ? `text:${field.value}`
    : `${field.type}:${'window' in field ? field.window : ''}:${'aggregate' in field ? field.aggregate : ''}:${'windowOffset' in field ? field.windowOffset : ''}`;
  const counterparts = { targetHeartRate: 'heartRate', targetPace: 'pace', targetSpeed: 'speed' } as const;
  let reserved = required.length;
  for (const target of required.filter(field => field.type.startsWith('target'))) {
    const counterpart = counterparts[target.type as keyof typeof counterparts];
    if (!longNote && counterpart && reserved < 5) {
      fields.push(counterpart === 'pace' && !rest
        ? { type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' }
        : { type: counterpart, title: { heartRate: 'HR', pace: 'Pace', speed: 'Speed' }[counterpart] });
      reserved++;
    }
    fields.push(target);
  }
  fields.push(...required.filter(field => field.type === 'text'));
  // Planned contexts share one compact text cell, leaving native numeric fields
  // available. Never truncate an instruction or number to make it fit.
  const contexts: string[] = [];
  let contextIndex = -1;
  for (const selection of selections) {
    const report = (state: SuuntoSwimmingChoiceResult['state'], reason: string) => choices.push({ field: selection, state, reason });
    if (selection === 'interval') {
      report(heading !== title ? 'heading' : 'omitted', heading !== title
        ? `In heading: ${heading}. No metric slot used.` : 'No bounded interval number is available for this step.');
      continue;
    }
    if (selection === 'swolf' && sport !== ActivityTypes.Swimming) {
      report('omitted', 'SWOLF is available only for pool swimming.'); continue;
    }
    let field: SuuntoSwimmingField | null = null;
    if (isSuuntoPreviousLapField(selection)) {
      if (!rest || previous?.step.purpose !== 'work') {
        report('omitted', 'Available only on Rest immediately after Work; no earlier phase is substituted.'); continue;
      }
      field = selection === 'previousLapPace'
        ? { type: 'pace', title: 'PrevPace', window: 'manualLap', aggregate: 'average', windowOffset: -1 }
        : { type: selection === 'previousLapDuration' ? 'duration' : 'strokes',
          title: selection === 'previousLapDuration' ? 'PrevTime' : 'PrevStrk', window: 'manualLap', windowOffset: -1 };
    } else if (selection === 'previousPlannedDistance' || selection === 'nextPlannedDistance') {
      const distance = plannedDistance(selection === 'previousPlannedDistance' ? previous : next, units);
      if (!distance) { report('omitted', 'The adjacent Work step has no prescribed distance.'); continue; }
      const context = `${selection === 'previousPlannedDistance' ? 'Prev' : 'Next'}: ${distance}`;
      const combined = [...contexts, context].join(' / ');
      if (Array.from(`Plan ${combined}`).length > 40) { report('omitted', 'Planned distance text would exceed the short-text limit.'); continue; }
      field = { type: 'text', value: `Plan ${combined}` };
      if (contextIndex >= 0) {
        fields[contextIndex] = field; contexts.push(context);
        report('included', 'Included as planned text; Suunto may crop text beside numeric fields.'); continue;
      }
    } else {
      switch (selection) {
        case 'heartRate': field = { type: 'heartRate', title: 'HR' }; break;
        case 'workoutDistance': field = { type: 'distance', title: 'Total', window: 'workout' }; break;
        case 'workoutStrokes': field = { type: 'strokes', title: 'Tot strk', window: 'workout' }; break;
        case 'distance':
          if (fields.some(value => value.type === 'stepDistanceCountdown')) {
            report('included', 'Already included as the distance-remaining countdown.'); continue;
          }
          field = { type: 'distance', title: 'Swum', window: 'step' }; break;
        case 'duration': field = { type: 'duration', title: 'Elapsed', window: 'step' }; break;
        case 'pace': field = { type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' }; break;
        case 'strokes': field = { type: 'strokes', title: 'Strokes', window: 'manualLap' }; break;
        case 'strokeRate': field = { type: 'strokeRate', title: 'Avg strk', window: 'manualLap', aggregate: 'average' }; break;
        case 'swolf': field = { type: 'swolf', title: 'AvgSWOLF', window: 'manualLap', aggregate: 'average' }; break;
      }
    }
    if (field && fields.some(existing => key(existing) === key(field!))) {
      report('included', 'Already included in this screen.'); continue;
    }
    if (longNote || fields.length >= 5) {
      report('omitted', longNote ? 'The authored instruction uses the text-only layout.'
        : 'No space after the ending, targets, instructions and higher-priority fields.'); continue;
    }
    if (field) {
      if (field.type === 'text') { contextIndex = fields.length; contexts.push(field.value.slice('Plan '.length)); }
      fields.push(field);
      report('included', isSuuntoPreviousLapField(selection)
        ? 'Previous closed manual lap. An extra Lap press during Work limits this to its final segment; swim readings need watch data.'
        : field.type === 'text' ? 'Included as planned text; Suunto may crop text beside numeric fields.'
          : 'Included as a native reading; it needs data from the watch.');
    }
  }
  return { title: heading, choices, fields: fields.length ? fields : [{ type: 'text', value: 'Lap to finish' }] };
}

/** Allocation-only shapes: no fabricated target numbers are displayed or sent. */
export function suuntoSwimmingRequiredShapes(step: WorkoutStepV1): SuuntoSwimmingField[] {
  const fields: SuuntoSwimmingField[] = step.ending.kind === 'time'
    ? [{ type: 'stepDurationCountdown', value: step.ending.seconds, title: 'Time rem' }]
    : step.ending.kind === 'distance' ? [{ type: 'stepDistanceCountdown', value: step.ending.meters, title: 'Dist rem' }] : [];
  for (const target of step.targets) fields.push({ type: target.kind === 'heart-rate' ? 'targetHeartRate'
    : target.kind === 'power' ? 'targetPower' : target.kind === 'cadence' ? 'targetCadence'
      : target.presentation === 'pace' ? 'targetPace' : 'targetSpeed', min: 0, max: 0, title: '' });
  if (step.note) fields.push({ type: 'text', value: Array.from(suuntoGuideWatchTextV1(step.note))
    .slice(0, fields.length ? 40 : 54).join('') });
  return fields;
}
