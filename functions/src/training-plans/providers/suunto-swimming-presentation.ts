import { ActivityTypes, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { formatWorkoutEndingV1, type WorkoutStepV1, type WorkoutStructureV1 } from '../../../../shared/planned-workout';
import { suuntoGuideWatchTextV1 } from '../../../../shared/suunto-guide-presentation';
import { normalizeSuuntoSwimmingGuideSettingsForRecovery, type SuuntoSwimmingGuideSettings } from '../../../../shared/suunto-swimming-guide-settings';
import type { SuuntoGuideFieldV1, SuuntoGuideFieldsStepV1, SuuntoGuideStepV1 } from './suunto-guide.serializer';

type Occurrence = { step: WorkoutStepV1; interval?: number; total: number };
export const isSuuntoSwimmingSport = (sport: ActivityTypes): boolean => sport === ActivityTypes.Swimming || sport === ActivityTypes.OpenWaterSwimming;

function plannedDistance(occurrence: Occurrence | undefined, prefix: string, units?: UserUnitSettingsInterface): SuuntoGuideFieldV1 | null {
  if (occurrence?.step.purpose !== 'work' || occurrence.step.ending.kind !== 'distance') return null;
  const value = suuntoGuideWatchTextV1(`${prefix}: ${formatWorkoutEndingV1(occurrence.step.ending, units)}`);
  // Never truncate a generated prescription into a different number.
  return Array.from(value).length <= 40 ? { type: 'text', value } : null;
}
function screenFields(screen: SuuntoGuideFieldsStepV1, sport: ActivityTypes, settings: SuuntoSwimmingGuideSettings,
  occurrence?: Occurrence, previous?: Occurrence, next?: Occurrence, units?: UserUnitSettingsInterface): SuuntoGuideFieldV1[] {
  const required = screen.fields.filter(field => field.type.endsWith('Countdown') || field.type.startsWith('target') || field.type === 'text');
  if (required.some(field => field.type === 'text' && Array.from(field.value).length > 40)) return required;
  const isRest = occurrence?.step.purpose === 'rest' || screen.title === 'Rest';
  const fields = required.filter(field => field.type.endsWith('Countdown')).map(field => ({ ...field,
    ...('title' in field ? { title: isRest ? 'Rest rem' : field.type === 'stepDistanceCountdown' ? 'Dist rem' : 'Time rem' } : {}) }));
  const optional: SuuntoGuideFieldV1[] = [];
  let optionalSlotsUsed = 0;
  const key = (field: SuuntoGuideFieldV1): string => field.type === 'text' ? `text:${field.value}`
    : `${field.type}:${'window' in field ? field.window : ''}:${'aggregate' in field ? field.aggregate : ''}`;
  const add = (field: SuuntoGuideFieldV1 | null) => {
    if (field && optionalSlotsUsed < 5 - required.length && ![...fields, ...optional].some(existing => key(existing) === key(field))) {
      optional.push(field); optionalSlotsUsed++;
    }
  };
  // Authored targets retain their slots; pair each with an already-supported
  // measured counterpart when space permits. No swimming power/cadence inference.
  const counterparts: Record<string, 'heartRate' | 'pace' | 'speed'> = { targetHeartRate: 'heartRate', targetPace: 'pace', targetSpeed: 'speed' };
  for (const target of required.filter(field => field.type.startsWith('target'))) {
    const counterpart = counterparts[target.type];
    // Stationary Rest cannot reuse v11's freshly reset lap-average pace.
    // Preserve only the documented current target reading, not a last-effort claim.
    const reading: SuuntoGuideFieldV1 | undefined = counterpart && isRest
      ? { type: counterpart, title: { heartRate: 'HR', pace: 'Pace', speed: 'Speed' }[counterpart] }
      : screen.fields.find(field => field.type === counterpart);
    add(reading ?? null);
    const paired = optional.findIndex(field => field.type === counterparts[target.type]);
    if (paired >= 0) fields.push(...optional.splice(paired, 1));
    fields.push(target);
  }
  fields.push(...required.filter(field => field.type === 'text'));
  // The budget above reserves all authored fields, including both targets and
  // instructions, before spending any remaining slots on owner display choices.
  const available = 5 - fields.length;
  const selections = isRest ? settings.restFields : settings.workFields;
  for (const selection of selections) {
    if (optional.length >= available) break;
    switch (selection) {
      case 'interval': add(occurrence?.interval ? { type: 'text', value: `Interval ${occurrence.interval}/${occurrence.total}` } : null); break;
      case 'previousPlannedDistance': add(plannedDistance(previous, 'Prev plan', units)); break;
      case 'nextPlannedDistance': add(plannedDistance(next, 'Next plan', units)); break;
      case 'heartRate': add({ type: 'heartRate', title: 'HR' }); break;
      case 'workoutDistance': add({ type: 'distance', title: 'Total', window: 'workout' }); break;
      case 'workoutStrokes': add({ type: 'strokes', title: 'Tot strk', window: 'workout' }); break;
      case 'distance':
        if (!fields.some(field => field.type === 'stepDistanceCountdown')) add({ type: 'distance', title: 'Swum', window: 'step' });
        break;
      case 'duration': add({ type: 'duration', title: 'Elapsed', window: 'step' }); break;
      case 'pace': add({ type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' }); break;
      case 'strokes': add({ type: 'strokes', title: 'Strokes', window: 'manualLap' }); break;
      case 'strokeRate': add({ type: 'strokeRate', title: 'Avg strk', window: 'manualLap', aggregate: 'average' }); break;
      case 'swolf':
        if (sport === ActivityTypes.Swimming) add({ type: 'swolf', title: 'AvgSWOLF', window: 'manualLap', aggregate: 'average' });
        break;
    }
  }
  fields.push(...optional);
  return fields.length ? fields : [{ type: 'text', value: 'Lap to finish' }];
}

function shortRestNotification<T extends SuuntoGuideFieldsStepV1>(screen: T): T {
  // Suunto start notifications remain visible for about 20 seconds. A generated
  // popup can outlast a short rest and overlap the next Work notification.
  // Keep all authored notes, manual/long rests and every Work/Complete alert.
  if (screen.title !== 'Rest' || screen.fields.some(field => field.type === 'text')
    || !screen.fields.some(field => field.type === 'stepDurationCountdown' && field.value <= 20)) return screen;
  const rest = { ...screen };
  delete rest.notification;
  return rest;
}

/** The frozen execution graph, laps, targets and authored instructions stay
 * intact. Only fields and short generated Rest popups change. Previous measured laps are not available in
 * the published Guide schema: planned context must be labelled as planned. */
export function presentSuuntoSwimmingScreens(structure: WorkoutStructureV1, steps: SuuntoGuideStepV1[],
  rawSettings: unknown, units: UserUnitSettingsInterface | undefined,
  jsonBytes: (steps: SuuntoGuideStepV1[]) => number): SuuntoGuideStepV1[] {
  if (!isSuuntoSwimmingSport(structure.sport)) return steps;
  const settings = normalizeSuuntoSwimmingGuideSettingsForRecovery(rawSettings);
  const fits = (candidate: SuuntoGuideStepV1[]) => jsonBytes(candidate.map(node => node.type === 'repeat'
    ? { ...node, steps: node.steps.map(screen => ({ ...screen, ...(screen.notification ? { notification: { ...screen.notification, type: 'default' } } : {}) })) }
    : { ...node, ...(node.notification ? { notification: { ...node.notification, type: 'default' } } : {}) })) <= 256 * 1024;
  const decorate = <T extends SuuntoGuideFieldsStepV1>(screen: T): T => !['Work', 'Rest'].includes(screen.title)
    ? screen : { ...shortRestNotification(screen), fields: screenFields(screen, structure.sport, settings) };
  const compact = steps.map(node => node.type === 'repeat' ? { ...node, steps: node.steps.map(decorate) } : decorate(node));
  const fallback = () => fits(compact) ? compact : steps;
  const count = steps.reduce((sum, node) => sum + (node.type === 'repeat' ? node.times * node.steps.length : 1), 0);
  if (count > 1000) return fallback();
  const authored = structure.nodes.flatMap(node => node.kind === 'step' ? [node]
    : Array.from({ length: node.count }, () => node.steps).flat());
  const total = authored.filter(step => step.purpose === 'work').length;
  let interval = 0;
  const occurrences: Occurrence[] = authored.map((step, index) => {
    if (step.purpose === 'work') interval++;
    return { step, total, ...(step.purpose === 'work' || step.purpose === 'rest' && authored[index - 1]?.purpose === 'work' ? { interval } : {}) };
  });
  const branches = steps.some(node => node.type === 'fields' && node.id?.startsWith('qs-boundary-'));
  let position = 0;
  const expanded = steps.flatMap(node => node.type === 'repeat'
    ? Array.from({ length: node.times }, () => node.steps.map(screen => ({ ...screen, id: `qs-swim-${position++}` }))).flat()
    : (position++, [node]));
  position = 0;
  const presented = expanded.map(screen => {
    const index = branches ? Number(/^qs-boundary-(\d+)-(auto|lap)$/.exec(screen.id ?? '')?.[1]) : position++;
    const occurrence = occurrences[index];
    if (!occurrence || !['work', 'rest'].includes(occurrence.step.purpose)) return screen;
    return { ...shortRestNotification(screen), fields: screenFields(screen, structure.sport, settings, occurrence, occurrences[index - 1], occurrences[index + 1], units) };
  });
  return fits(presented) ? presented : fallback();
}
