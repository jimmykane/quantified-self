import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { WorkoutStructureV1 } from '../../../../shared/planned-workout';
import { planSuuntoSwimmingScreen, suuntoSwimmingOccurrences, SUUNTO_SWIMMING_EXPANDED_SCREEN_LIMIT,
  type SuuntoSwimmingOccurrence } from '../../../../shared/suunto-swimming-screen';
import type { SuuntoGuideFieldsStepV1, SuuntoGuideStepV1 } from './suunto-guide.serializer';
import { isSuuntoSwimmingSport } from './suunto-swimming-presentation';

/** V14 remains immutable. V15 changes presentation, never transitions/laps. */
export function presentSuuntoSwimmingScreensV15(structure: WorkoutStructureV1, steps: SuuntoGuideStepV1[],
  settings: unknown, units: UserUnitSettingsInterface | undefined,
  jsonBytes: (steps: SuuntoGuideStepV1[]) => number, previousLapReadings = false, readableRestContext = false): SuuntoGuideStepV1[] {
  if (!isSuuntoSwimmingSport(structure.sport)) return steps;
  const fits = (candidate: SuuntoGuideStepV1[]) => jsonBytes(candidate.map(node => node.type === 'repeat'
    ? { ...node, steps: node.steps.map(enrichNotification) } : enrichNotification(node))) <= 256 * 1024;
  const decorate = <T extends SuuntoGuideFieldsStepV1>(screen: T, occurrence?: SuuntoSwimmingOccurrence,
    previous?: SuuntoSwimmingOccurrence, next?: SuuntoSwimmingOccurrence): T => {
    if (!['Work', 'Rest'].includes(screen.title)) return screen;
    const planned = planSuuntoSwimmingScreen(screen.title, screen.fields, structure.sport, settings, occurrence, previous, next, units, previousLapReadings, readableRestContext);
    const result = { ...screen, title: planned.title, fields: planned.fields,
      ...(screen.notification ? { notification: { ...screen.notification, title: planned.title } } : {}) };
    // Match the existing short-rest policy before introducing context text.
    if (screen.title === 'Rest' && !screen.fields.some(field => field.type === 'text')
      && screen.fields.some(field => field.type === 'stepDurationCountdown' && field.value <= 20)) delete result.notification;
    return result;
  };
  const compact = steps.map(node => node.type === 'repeat' ? { ...node, steps: node.steps.map(screen => decorate(screen)) } : decorate(node));
  const fallback = () => fits(compact) ? compact : steps;
  const count = steps.reduce((sum, node) => sum + (node.type === 'repeat' ? node.times * node.steps.length : 1), 0);
  if (count > SUUNTO_SWIMMING_EXPANDED_SCREEN_LIMIT) return fallback();
  const occurrences = suuntoSwimmingOccurrences(structure, previousLapReadings);
  if (!occurrences) return fallback();
  const branches = steps.some(node => node.type === 'fields' && node.id?.startsWith('qs-boundary-'));
  let position = 0;
  const expanded = steps.flatMap(node => node.type === 'repeat'
    ? Array.from({ length: node.times }, () => node.steps.map(screen => ({ ...screen, id: `qs-swim-${position++}` }))).flat()
    : (position++, [node]));
  position = 0;
  const presented = expanded.map(screen => {
    const index = branches ? Number(/^qs-boundary-(\d+)-(auto|lap)$/.exec(screen.id ?? '')?.[1]) : position++;
    const occurrence = occurrences[index];
    return occurrence ? decorate(screen, occurrence, occurrences[index - 1], occurrences[index + 1]) : screen;
  });
  return fits(presented) ? presented : fallback();
}
function enrichNotification<T extends SuuntoGuideFieldsStepV1>(screen: T): T {
  return { ...screen, ...(screen.notification ? { notification: { ...screen.notification, type: 'default' } } : {}) };
}
