import type { DayWorkoutControls, DayWorkoutDraft, DayWorkoutLoadSource } from '../../../shared/day-workout';
import { parseWorkoutStructureV1, type WorkoutTargetV1 } from '../../../shared/planned-workout';
import { analyzeWorkoutStructureV1 } from '../../../shared/planned-workout-analysis';
import { isStrengthWorkoutSportV1, parseStrengthWorkoutDraftV1, projectStrengthWorkoutToV1,
  type StrengthExerciseV1, type StrengthWorkoutDraftV1 } from '../../../shared/strength-workout';

export interface PreviousStrengthPrescription { localDate: string; strength: StrengthWorkoutDraftV1 }
export interface ValidatedDaySuggestion {
  kind: 'workout' | 'rest'; rationale: string; draft: DayWorkoutDraft | null; previousLoads: DayWorkoutLoadSource[];
}
export function normalizedExerciseName(name: string): string {
  // Equipment words remain significant: barbell and dumbbell prescriptions never match.
  return name.normalize('NFKC').trim().toLowerCase().replace(/[-_\s]+/g, ' ');
}
function prescription(exercise: StrengthExerciseV1): string {
  return JSON.stringify(exercise.sets.map(set => ({ ending: set.ending, rest: set.restAfterSeconds ?? null })));
}
export function reusePlannedLoads(draft: StrengthWorkoutDraftV1, history: readonly PreviousStrengthPrescription[]): DayWorkoutLoadSource[] {
  const sources: DayWorkoutLoadSource[] = [];
  for (const exercise of draft.exercises) {
    for (const set of exercise.sets) delete set.externalLoadKg;
    const key = normalizedExerciseName(exercise.name);
    const matches = history.flatMap(previous => previous.strength.exercises
      .filter(item => normalizedExerciseName(item.name) === key && prescription(item) === prescription(exercise))
      .map(item => ({ localDate: previous.localDate, exercise: item })))
      .sort((a, b) => b.localDate.localeCompare(a.localDate));
    if (!matches.length || matches.filter(item => item.localDate === matches[0].localDate).length !== 1) continue;
    const match = matches[0];
    let used = false;
    exercise.sets.forEach((set, index) => {
      const load = match.exercise.sets[index].externalLoadKg;
      if (load !== undefined) { set.externalLoadKg = load; used = true; }
    });
    if (used) sources.push({ exerciseId: exercise.id, localDate: match.localDate });
  }
  return sources;
}
export function validateDayWorkoutSuggestion(value: unknown, controls: DayWorkoutControls,
  history: readonly PreviousStrengthPrescription[] = [], references: readonly WorkoutTargetV1[] = []): ValidatedDaySuggestion {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 64_000) throw new Error('Invalid suggestion.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['kind', 'rationale', 'title', 'structure', 'strength', 'estimatedMinutes'].includes(key))
    || typeof row.rationale !== 'string' || !row.rationale.trim() || row.rationale.length > 1200) throw new Error('Invalid explanation.');
  if (row.kind === 'rest') {
    if (Object.keys(row).some(key => !['kind', 'rationale'].includes(key))) throw new Error('Rest cannot include a workout.');
    return { kind: 'rest', rationale: row.rationale.trim(), draft: null, previousLoads: [] };
  }
  if (row.kind !== 'workout' || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 120) throw new Error('Invalid workout title.');
  let strength: StrengthWorkoutDraftV1 | undefined;
  let previousLoads: DayWorkoutLoadSource[] = [];
  if (isStrengthWorkoutSportV1(controls.sport)) {
    if (row.structure !== undefined) throw new Error('Supply the full strength prescription only; its structure is derived.');
    strength = parseStrengthWorkoutDraftV1(row.strength);
    previousLoads = reusePlannedLoads(strength, controls.trainingContext && controls.usePreviousWeights ? history : []);
  } else if (row.strength !== undefined || row.estimatedMinutes !== undefined) throw new Error('Strength fields require a strength sport.');
  const structure = strength ? projectStrengthWorkoutToV1({ ...strength, workoutId: 'draft', revision: 1 }, controls.sport)
    : parseWorkoutStructureV1(row.structure);
  if (structure.sport !== controls.sport) throw new Error('The requested sport must be preserved.');
  if (!strength) {
    for (const node of structure.nodes) {
      if (controls.structure === 'simple' && node.kind === 'repeat') throw new Error('Use a simple session without repeats.');
      for (const step of node.kind === 'step' ? [node] : node.steps) {
        if (!['time', 'distance', 'manual'].includes(step.ending.kind)) throw new Error('Use editor-supported endings.');
        if (controls.timing === 'strict' && step.ending.kind !== 'time') throw new Error('Strict timing requires timed steps throughout.');
        for (const target of step.targets) {
          if (controls.target === 'none' || (controls.target !== 'auto' && controls.target !== target.kind)) throw new Error('Respect the selected target preference.');
          if (target.mode !== 'relative' || !references.some(ref => ref.mode === 'relative' && ref.kind === target.kind
            && JSON.stringify(ref.reference) === JSON.stringify(target.reference))) throw new Error('A target requires an available explicit athlete reference; otherwise use effort notes.');
        }
      }
    }
  }
  const analysis = analyzeWorkoutStructureV1(structure);
  if (controls.timing === 'strict' && (analysis.summary.duration.completeExactSeconds === null
    || analysis.summary.duration.completeExactSeconds > controls.minutes * 60)) throw new Error('The full prescription exceeds the strict time budget.');
  let estimatedMinutes: DayWorkoutDraft['estimatedMinutes'];
  if (row.estimatedMinutes !== undefined) {
    const range = row.estimatedMinutes as Record<string, unknown>;
    if (!range || typeof range !== 'object' || Array.isArray(range) || Object.keys(range).some(key => !['minimum', 'maximum'].includes(key))
      || typeof range.minimum !== 'number' || typeof range.maximum !== 'number' || !Number.isFinite(range.minimum)
      || !Number.isFinite(range.maximum) || range.minimum < 1 || range.maximum < range.minimum || range.maximum > 480) throw new Error('Invalid planning time range.');
    estimatedMinutes = { minimum: range.minimum, maximum: range.maximum };
  }
  return { kind: 'workout', rationale: row.rationale.trim(), previousLoads,
    draft: { title: row.title.trim(), structure, ...(strength ? { strength } : {}), ...(estimatedMinutes ? { estimatedMinutes } : {}) } };
}
