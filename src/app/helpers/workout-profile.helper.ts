import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import {
  formatWorkoutEndingV1,
  formatWorkoutTargetV1,
  parseWorkoutStructureV1,
  isRowingWorkoutSportV1,
  isSwimmingWorkoutSportV1,
  type WorkoutStructureV1,
  type WorkoutStepV1,
  type WorkoutTargetV1,
} from '@shared/planned-workout';

/** Presentation budget, not a recipe limit. Beyond this, repeats are represented by one selectable pass. */
export const WORKOUT_PROFILE_EXPANSION_BUDGET = 128;
export type WorkoutProfileMetric = 'heart-rate' | 'power' | 'pace' | 'speed' | 'cadence';
export const WORKOUT_PROFILE_METRIC_LABELS: Record<WorkoutProfileMetric, string> = {
  'heart-rate': 'Heart rate', power: 'Power', pace: 'Pace', speed: 'Speed', cadence: 'Cadence',
};
export const WORKOUT_PROFILE_PURPOSE_LABELS: Record<WorkoutStepV1['purpose'], string> = {
  warmup: 'Warm-up', work: 'Work', recovery: 'Recovery', cooldown: 'Cool-down', rest: 'Rest', other: 'Other',
};
export const WORKOUT_PROFILE_PURPOSE_SHORT_LABELS: Record<WorkoutStepV1['purpose'], string> = {
  warmup: 'WU', work: 'W', recovery: 'R', cooldown: 'CD', rest: 'Rest', other: 'O',
};

export interface WorkoutProfileSelection {
  occurrenceKey: string;
  stepId: string;
  repeatId: string | null;
  iteration: number | null;
}
export interface WorkoutProfileBand {
  metric: WorkoutProfileMetric;
  minimum: number;
  maximum: number;
  text: string;
  relative: boolean;
}
export interface WorkoutProfileOccurrence extends WorkoutProfileSelection {
  ordinal: number;
  purpose: WorkoutStepV1['purpose'];
  label: string;
  ending: string;
  targets: WorkoutProfileBand[];
  note: string | null;
}
export interface WorkoutProfileModel {
  structure: WorkoutStructureV1;
  occurrences: WorkoutProfileOccurrence[];
  occurrenceCount: number;
  grouped: boolean;
  repeats: Array<{ id: string; count: number; iteration: number; passes: number[] }>;
  metrics: WorkoutProfileMetric[];
  pool: string | null;
}

/** Only resolves authored, frozen target snapshots. No athlete lookup, timing, intensity or zone estimation. */
export function workoutProfileAbsoluteTarget(target: WorkoutTargetV1): WorkoutTargetV1 {
  if (target.mode === 'absolute') return target;
  const lower = target.minimumPercent / 100;
  const upper = target.maximumPercent / 100;
  switch (target.kind) {
    case 'heart-rate': return { kind: target.kind, mode: 'absolute',
      minimumBpm: target.reference.bpm * lower, maximumBpm: target.reference.bpm * upper };
    case 'power': return { kind: target.kind, mode: 'absolute',
      minimumWatts: target.reference.watts * lower, maximumWatts: target.reference.watts * upper };
    case 'cadence': return { kind: target.kind, mode: 'absolute',
      minimumRpm: target.reference.rpm * lower, maximumRpm: target.reference.rpm * upper };
    case 'speed': return { kind: target.kind, mode: 'absolute', presentation: target.presentation,
      minimumMetersPerSecond: target.reference.metersPerSecond * lower,
      maximumMetersPerSecond: target.reference.metersPerSecond * upper };
  }
}

function paceDistance(structure: WorkoutStructureV1): number {
  return isSwimmingWorkoutSportV1(structure.sport) ? 100 : isRowingWorkoutSportV1(structure.sport) ? 500 : 1000;
}

function bandForTarget(target: WorkoutTargetV1, structure: WorkoutStructureV1,
  units?: UserUnitSettingsInterface | null, locale?: string): WorkoutProfileBand {
  const absolute = workoutProfileAbsoluteTarget(target);
  if (absolute.mode !== 'absolute') throw new Error('Target snapshot could not be resolved.');
  const text = formatWorkoutTargetV1(target, units, locale, structure.sport);
  const bandText = target.mode === 'relative'
    ? `${text} · ${formatWorkoutTargetV1(absolute, units, locale, structure.sport)} (saved reference)` : text;
  switch (absolute.kind) {
    case 'heart-rate': return { metric: absolute.kind, minimum: absolute.minimumBpm,
      maximum: absolute.maximumBpm, text: bandText, relative: target.mode === 'relative' };
    case 'power': return { metric: absolute.kind, minimum: absolute.minimumWatts,
      maximum: absolute.maximumWatts, text: bandText, relative: target.mode === 'relative' };
    case 'cadence': return { metric: absolute.kind, minimum: absolute.minimumRpm,
      maximum: absolute.maximumRpm, text: bandText, relative: target.mode === 'relative' };
    case 'speed': return absolute.presentation === 'pace'
      ? { metric: 'pace', minimum: paceDistance(structure) / absolute.maximumMetersPerSecond,
        maximum: paceDistance(structure) / absolute.minimumMetersPerSecond, text: bandText, relative: target.mode === 'relative' }
      : { metric: 'speed', minimum: absolute.minimumMetersPerSecond,
        maximum: absolute.maximumMetersPerSecond, text: bandText, relative: target.mode === 'relative' };
  }
}

export function buildWorkoutProfile(structure: WorkoutStructureV1,
  units?: UserUnitSettingsInterface | null, locale?: string,
  repeatPasses: Readonly<Record<string, number>> = {}): WorkoutProfileModel {
  const parsed = parseWorkoutStructureV1(structure);
  const occurrenceCount = parsed.nodes.reduce((sum, node) => sum + (node.kind === 'step' ? 1 : node.count * node.steps.length), 0);
  const grouped = occurrenceCount > WORKOUT_PROFILE_EXPANSION_BUDGET;
  const occurrences: WorkoutProfileOccurrence[] = [];
  const repeats: WorkoutProfileModel['repeats'] = [];
  let ordinal = 1;
  const append = (step: WorkoutStepV1, index: number, repeatId: string | null, iteration: number | null, count?: number) => {
    const repeatLabel = repeatId ? ` · Repeat pass ${iteration} of ${count}` : '';
    occurrences.push({ occurrenceKey: `${repeatId ?? 'root'}/${iteration ?? 1}/${step.id}`,
      stepId: step.id, repeatId, iteration, ordinal: index, purpose: step.purpose,
      label: `Step ${index} · ${WORKOUT_PROFILE_PURPOSE_LABELS[step.purpose]}${repeatLabel}`,
      ending: formatWorkoutEndingV1(step.ending, units, locale, parsed.sport),
      targets: step.targets.map(target => {
        const band = bandForTarget(target, parsed, units, locale);
        if (!Number.isFinite(band.minimum) || !Number.isFinite(band.maximum)) throw new Error('Target range cannot be plotted.');
        return band;
      }), note: step.note ?? null });
  };
  for (const node of parsed.nodes) {
    if (node.kind === 'step') {
      append(node, ordinal++, null, null);
      continue;
    }
    const requestedPass = repeatPasses[node.id];
    const iteration = Number.isInteger(requestedPass) && requestedPass >= 1 && requestedPass <= node.count ? requestedPass : 1;
    if (grouped) {
      repeats.push({ id: node.id, count: node.count, iteration, passes: Array.from({ length: node.count }, (_, i) => i + 1) });
      node.steps.forEach((step, index) => append(step, ordinal + (iteration - 1) * node.steps.length + index,
        node.id, iteration, node.count));
    } else {
      for (let pass = 1; pass <= node.count; pass++) {
        node.steps.forEach((step, index) => append(step, ordinal + (pass - 1) * node.steps.length + index,
          node.id, pass, node.count));
      }
    }
    ordinal += node.count * node.steps.length;
  }
  const metrics = [...new Set(occurrences.flatMap(step => step.targets.map(target => target.metric)))];
  const pool = parsed.poolLength
    ? formatWorkoutEndingV1({ kind: 'distance', meters: parsed.poolLength.meters }, units, locale, parsed.sport) : null;
  return { structure: parsed, occurrences, occurrenceCount, grouped, repeats, metrics, pool };
}

/** Axis values use the same canonical formatter as details and tooltips, including swim/rowing pace. */
export function formatWorkoutProfileAxis(value: number, metric: WorkoutProfileMetric, structure: WorkoutStructureV1,
  units?: UserUnitSettingsInterface | null, locale?: string): string {
  if (!Number.isFinite(value) || value < 0) return '';
  switch (metric) {
    case 'heart-rate': return formatWorkoutTargetV1({ kind: metric, mode: 'absolute', minimumBpm: value, maximumBpm: value }, units, locale, structure.sport);
    case 'power': return formatWorkoutTargetV1({ kind: metric, mode: 'absolute', minimumWatts: value, maximumWatts: value }, units, locale, structure.sport);
    case 'cadence': return formatWorkoutTargetV1({ kind: metric, mode: 'absolute', minimumRpm: value, maximumRpm: value }, units, locale, structure.sport);
    case 'pace':
    case 'speed': {
      if (value === 0 && metric === 'pace') return '';
      const speed = metric === 'pace' ? paceDistance(structure) / value : value;
      return formatWorkoutTargetV1({ kind: 'speed', mode: 'absolute', presentation: metric,
        minimumMetersPerSecond: speed, maximumMetersPerSecond: speed }, units, locale, structure.sport);
    }
  }
}
