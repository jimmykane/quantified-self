import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { WorkoutStepV1, WorkoutStructureV1 } from '../../../../shared/planned-workout';
import { suuntoGuideLiveReadingsV1, suuntoGuideWatchTextV1 } from '../../../../shared/suunto-guide-presentation';
import type { SuuntoGuideFieldV1, SuuntoGuideFieldsStepV1, SuuntoGuideStepV1 } from './suunto-guide.serializer';

const SPORTS = new Set([ActivityTypes.Running, ActivityTypes.TrailRunning, ActivityTypes.Treadmill,
  ActivityTypes.Cycling, ActivityTypes.MountainBiking, ActivityTypes.IndoorCycling, ActivityTypes.EBiking,
  ActivityTypes.Handcycle, ActivityTypes.Walking, ActivityTypes.Hiking, ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming]);
const SWIM = new Set([ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming]);
// Readback must fit the existing archive's decompressed JSON limit, not merely
// the partner's screen limit. Never reject a compact repeat just for numbering.
const MAX_SCREENS = 1000;
const MAX_JSON_BYTES = 256 * 1024;

export function hasSuuntoRestPresentation(structure: WorkoutStructureV1): boolean {
  return SPORTS.has(structure.sport) && structure.nodes.some(node => {
    if (node.kind === 'repeat' && node.steps.length === 2
      && node.steps[0].purpose === 'work' && node.steps[1].purpose === 'rest') return true;
    return (node.kind === 'step' ? [node] : node.steps).some(step => step.purpose === 'rest'
      && !(step.ending.kind === 'manual' && !step.targets.length && step.note
        && Array.from(suuntoGuideWatchTextV1(step.note)).length > 40));
  });
}

type Occurrence = { step: WorkoutStepV1; pass?: number; count?: number };
const phase = (purpose: WorkoutStepV1['purpose']): string => ({ warmup: 'Warm up', work: 'Work',
  recovery: 'Recovery', cooldown: 'Cool down', rest: 'Rest', other: 'Next' })[purpose];
function title(occurrence: Occurrence): string {
  const base = phase(occurrence.step.purpose);
  // Only a simple Work/Rest pair is numbered: complex repeated sequences must
  // not misrepresent a repeat pass as the number of completed work intervals.
  return occurrence.pass === undefined ? base : `${base} ${occurrence.pass}/${occurrence.count}`;
}

function restFields(screen: SuuntoGuideFieldsStepV1, sport: ActivityTypes, next?: Occurrence): SuuntoGuideFieldV1[] {
  const required = screen.fields.filter(field => field.type === 'text'
    || field.type.startsWith('target') || field.type.endsWith('Countdown'));
  if (required.some(field => field.type === 'text' && Array.from(field.value).length > 40)) return required;
  const fields: SuuntoGuideFieldV1[] = required.map(field => field.type === 'stepDurationCountdown'
    ? { ...field, title: 'Rest rem' } : field);
  const counterparts: Record<string, 'heartRate' | 'power' | 'pace' | 'speed' | 'cadence'> = {
    targetHeartRate: 'heartRate', targetPower: 'power', targetPace: 'pace', targetSpeed: 'speed', targetCadence: 'cadence',
  };
  // Match the existing measured-target capability boundary. A swim/walking
  // power/cadence prescription does not prove a watch sensor reading exists.
  const hasPowerCadence = suuntoGuideLiveReadingsV1(sport)[0] === 'power'
    || [ActivityTypes.Running, ActivityTypes.TrailRunning, ActivityTypes.Treadmill].includes(sport);
  if (!hasPowerCadence) { delete counterparts.targetPower; delete counterparts.targetCadence; }
  const labels = { heartRate: 'HR', power: 'Power', pace: 'Pace', speed: 'Speed', cadence: 'Cadence' };
  // Current Rest readings, never freshly reset averages labelled as last Work.
  // Keep both authored target counterparts ahead of optional phase/context.
  for (const type of new Set([...required.flatMap(field => counterparts[field.type] ? [counterparts[field.type]] : []), 'heartRate' as const])) {
    if (fields.length < 5) fields.push({ type, title: labels[type] });
  }
  if (next && fields.length < 5) fields.push({ type: 'text', value: `Next: ${next.step.purpose === 'other' ? 'Interval' : title(next)}` });
  if (SWIM.has(sport) && fields.length < 5) fields.push({ type: 'distance', title: 'Total', window: 'workout' });
  return fields;
}

/** Decorate the frozen v11 execution graph; never calculate or change a Lap,
 * condition, target, prescription, notification text or completion transition. */
export function presentSuuntoRestScreens(structure: WorkoutStructureV1, steps: SuuntoGuideStepV1[],
  jsonBytes: (steps: SuuntoGuideStepV1[]) => number): SuuntoGuideStepV1[] {
  if (!hasSuuntoRestPresentation(structure)) return steps;
  const compact = steps.map(node => node.type === 'repeat' ? { ...node, steps: node.steps.map(screen =>
    screen.title === 'Rest' ? { ...screen, fields: restFields(screen, structure.sport) } : screen) }
    : node.title === 'Rest' ? { ...node, fields: restFields(node, structure.sport) } : node);
  const screenCount = steps.reduce((total, node) => total + (node.type === 'repeat' ? node.times * node.steps.length : 1), 0);
  if (screenCount > MAX_SCREENS) return compact;

  const occurrences: Occurrence[] = structure.nodes.flatMap(node => {
    if (node.kind === 'step') return [{ step: node }];
    const numbered = node.steps.length === 2 && node.steps[0].purpose === 'work' && node.steps[1].purpose === 'rest';
    return Array.from({ length: node.count }, (_, index) => node.steps.map(step => ({ step,
      ...(numbered ? { pass: index + 1, count: node.count } : {}) }))).flat();
  });
  const hasBranches = steps.some(node => node.type === 'fields' && node.id?.startsWith('qs-boundary-'));
  let index = 0;
  const expanded = steps.flatMap(node => {
    if (node.type === 'repeat') return Array.from({ length: node.times }, () =>
      node.steps.map(screen => ({ ...screen, id: `qs-rest-${index++}` }))).flat();
    index++;
    return [node];
  });
  let position = 0;
  const numbered = expanded.map(screen => {
    const occurrenceIndex = hasBranches ? Number(/^qs-boundary-(\d+)-(auto|lap)$/.exec(screen.id ?? '')?.[1]) : position++;
    const occurrence = occurrences[occurrenceIndex];
    // Complete and both exit-path variants retain their original graph IDs.
    if (!occurrence) return screen;
    const name = title(occurrence);
    return { ...screen, title: name,
      ...(screen.notification ? { notification: { ...screen.notification, title: name } } : {}),
      fields: occurrence.step.purpose === 'rest'
        ? restFields(screen, structure.sport, occurrences[occurrenceIndex + 1]) : screen.fields };
  });
  // Suunto may enrich every notification with its default type. Reserve those
  // bytes too so a successfully uploaded Guide remains readable for recovery.
  const readback = numbered.map(screen => ({ ...screen,
    ...(screen.notification ? { notification: { ...screen.notification, type: 'default' } } : {}) }));
  return jsonBytes(readback) <= MAX_JSON_BYTES ? numbered : compact;
}
