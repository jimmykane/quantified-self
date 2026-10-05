import {
  WORKOUT_STEP_PURPOSES,
  countWorkoutStructureNodesV1,
  parseWorkoutStructureV1,
  type WorkoutStepPurposeV1,
  type WorkoutStepV1,
} from './planned-workout';

export type WorkoutAnalysisCoverageV1 = 'none' | 'partial' | 'complete';
export const WORKOUT_DURATION_UNKNOWN_REASONS_V1 = [
  'manual-ending', 'repetitions-ending', 'kilojoules-ending', 'missing-speed', 'unbounded-speed',
] as const;
export type WorkoutStepDurationV1 =
  | { kind: 'exact'; seconds: number }
  | { kind: 'estimated'; minimumSeconds: number; maximumSeconds: number;
      basis: 'absolute-speed' | 'saved-threshold-speed' }
  | { kind: 'unknown'; reason: typeof WORKOUT_DURATION_UNKNOWN_REASONS_V1[number] };
export interface WorkoutDurationRangeV1 { minimumSeconds: number; maximumSeconds: number }
export interface WorkoutAnalysisSummaryV1 {
  executedSteps: number;
  duration: {
    exactSubtotalSeconds: number;
    exactSteps: number;
    estimatedSubtotalRange: WorkoutDurationRangeV1 | null;
    estimatedSteps: number;
    unknownSteps: number;
    coveredSubtotalRange: WorkoutDurationRangeV1 | null;
    completeExactSeconds: number | null;
    completeRange: WorkoutDurationRangeV1 | null;
    coverage: WorkoutAnalysisCoverageV1;
  };
  distance: {
    exactSubtotalMeters: number;
    exactSteps: number;
    unknownSteps: number;
    completeExactMeters: number | null;
    coverage: WorkoutAnalysisCoverageV1;
  };
}
export interface WorkoutAnalysisCountsV1 {
  /** Includes repeat containers and each leaf definition once. */
  structuralNodes: number;
  definedSteps: number;
  /** Repeat count is the total number of passes, not additional passes. */
  executedSteps: number;
}
export interface WorkoutStepAnalysisV1 {
  stepId: string;
  repeatId: string | null;
  multiplier: number;
  purpose: WorkoutStepPurposeV1;
  /** Values below describe one execution; summaries apply multiplier. */
  prescribedSeconds: number | null;
  prescribedMeters: number | null;
  duration: WorkoutStepDurationV1;
}
export interface WorkoutAnalysisV1 {
  version: 1;
  counts: WorkoutAnalysisCountsV1;
  summary: WorkoutAnalysisSummaryV1;
  byPurpose: Record<WorkoutStepPurposeV1, WorkoutAnalysisSummaryV1>;
  /** At most 100 definitions. Never expands repeats. */
  steps: WorkoutStepAnalysisV1[];
}
export interface WorkoutAnalysisAggregateV1 extends Omit<WorkoutAnalysisV1, 'steps'> {
  workoutCount: number;
  sourceComplete: boolean;
}

/** Canonically valid numbers can still overflow arithmetic; never serialize Infinity as null. */
export class WorkoutAnalysisArithmeticError extends RangeError {
  constructor() { super('Workout prescription arithmetic is outside the finite numeric range.'); }
}
function finite(value: number, positive = false): number {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0)) throw new WorkoutAnalysisArithmeticError();
  return value;
}
function safeCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new WorkoutAnalysisArithmeticError();
  return value;
}
function emptySummary(): WorkoutAnalysisSummaryV1 {
  return { executedSteps: 0, duration: { exactSubtotalSeconds: 0, exactSteps: 0,
    estimatedSubtotalRange: null, estimatedSteps: 0, unknownSteps: 0, coveredSubtotalRange: null,
    completeExactSeconds: null, completeRange: null, coverage: 'none' },
  distance: { exactSubtotalMeters: 0, exactSteps: 0, unknownSteps: 0, completeExactMeters: null, coverage: 'none' } };
}
function emptyPurposes(): WorkoutAnalysisV1['byPurpose'] {
  return Object.fromEntries(WORKOUT_STEP_PURPOSES.map(purpose => [purpose, emptySummary()])) as WorkoutAnalysisV1['byPurpose'];
}
function coverage(known: number, total: number, sourceComplete: boolean): WorkoutAnalysisCoverageV1 {
  return known === 0 ? 'none' : known === total && sourceComplete ? 'complete' : 'partial';
}
function finalize(summary: WorkoutAnalysisSummaryV1, sourceComplete: boolean): void {
  const { duration, distance, executedSteps } = summary;
  duration.coverage = coverage(duration.exactSteps + duration.estimatedSteps, executedSteps, sourceComplete);
  duration.coveredSubtotalRange = duration.exactSteps + duration.estimatedSteps === 0 ? null : {
    minimumSeconds: finite(duration.exactSubtotalSeconds + (duration.estimatedSubtotalRange?.minimumSeconds ?? 0)),
    maximumSeconds: finite(duration.exactSubtotalSeconds + (duration.estimatedSubtotalRange?.maximumSeconds ?? 0)),
  };
  duration.completeRange = duration.coverage === 'complete' ? { ...duration.coveredSubtotalRange! } : null;
  duration.completeExactSeconds = duration.coverage === 'complete' && duration.estimatedSteps === 0
    ? duration.exactSubtotalSeconds : null;
  distance.coverage = coverage(distance.exactSteps, executedSteps, sourceComplete);
  distance.completeExactMeters = distance.coverage === 'complete' ? distance.exactSubtotalMeters : null;
}
function analyzeDuration(step: WorkoutStepV1): WorkoutStepDurationV1 {
  const ending = step.ending;
  switch (ending.kind) {
    case 'time': return { kind: 'exact', seconds: ending.seconds };
    case 'manual': return { kind: 'unknown', reason: 'manual-ending' };
    case 'repetitions': return { kind: 'unknown', reason: 'repetitions-ending' };
    case 'kilojoules': return { kind: 'unknown', reason: 'kilojoules-ending' };
    case 'distance': {
      const speed = step.targets.find(target => target.kind === 'speed');
      if (!speed) return { kind: 'unknown', reason: 'missing-speed' };
      const minimum = speed.mode === 'absolute' ? speed.minimumMetersPerSecond : speed.minimumPercent;
      if (minimum === 0) return { kind: 'unknown', reason: 'unbounded-speed' };
      const minimumSpeed = speed.mode === 'absolute' ? minimum
        : finite(speed.reference.metersPerSecond * (minimum / 100), true);
      const maximumSpeed = speed.mode === 'absolute' ? speed.maximumMetersPerSecond
        : finite(speed.reference.metersPerSecond * (speed.maximumPercent / 100), true);
      return { kind: 'estimated', minimumSeconds: finite(ending.meters / maximumSpeed, true),
        maximumSeconds: finite(ending.meters / minimumSpeed, true),
        basis: speed.mode === 'absolute' ? 'absolute-speed' : 'saved-threshold-speed' };
    }
  }
}
function addRange(left: WorkoutDurationRangeV1 | null, right: WorkoutDurationRangeV1): WorkoutDurationRangeV1 {
  return { minimumSeconds: finite((left?.minimumSeconds ?? 0) + right.minimumSeconds),
    maximumSeconds: finite((left?.maximumSeconds ?? 0) + right.maximumSeconds) };
}
function addStep(summary: WorkoutAnalysisSummaryV1, step: WorkoutStepAnalysisV1): void {
  const multiplier = step.multiplier;
  summary.executedSteps = safeCount(summary.executedSteps + multiplier);
  const duration = summary.duration;
  switch (step.duration.kind) {
    case 'exact':
      duration.exactSteps += multiplier;
      duration.exactSubtotalSeconds = finite(duration.exactSubtotalSeconds + finite(step.duration.seconds * multiplier));
      break;
    case 'estimated':
      duration.estimatedSteps += multiplier;
      duration.estimatedSubtotalRange = addRange(duration.estimatedSubtotalRange, {
        minimumSeconds: finite(step.duration.minimumSeconds * multiplier),
        maximumSeconds: finite(step.duration.maximumSeconds * multiplier),
      });
      break;
    case 'unknown': duration.unknownSteps += multiplier; break;
  }
  if (step.prescribedMeters !== null) {
    summary.distance.exactSteps += multiplier;
    summary.distance.exactSubtotalMeters = finite(summary.distance.exactSubtotalMeters + finite(step.prescribedMeters * multiplier));
  } else summary.distance.unknownSteps += multiplier;
}

/** No athlete defaults, provider reads, recipe mutation, rounding, or inferred distance. */
export function analyzeWorkoutStructureV1(value: unknown): WorkoutAnalysisV1 {
  const structure = parseWorkoutStructureV1(value);
  const analysis: WorkoutAnalysisV1 = { version: 1, counts: {
    structuralNodes: countWorkoutStructureNodesV1(structure), definedSteps: 0, executedSteps: 0,
  }, summary: emptySummary(), byPurpose: emptyPurposes(), steps: [] };
  for (const node of structure.nodes) {
    for (const step of node.kind === 'step' ? [node] : node.steps) {
      const result: WorkoutStepAnalysisV1 = { stepId: step.id, repeatId: node.kind === 'repeat' ? node.id : null,
        multiplier: node.kind === 'repeat' ? node.count : 1, purpose: step.purpose,
        prescribedSeconds: step.ending.kind === 'time' ? step.ending.seconds : null,
        prescribedMeters: step.ending.kind === 'distance' ? step.ending.meters : null, duration: analyzeDuration(step) };
      analysis.steps.push(result);
      addStep(analysis.summary, result);
      addStep(analysis.byPurpose[result.purpose], result);
    }
  }
  analysis.counts.definedSteps = analysis.steps.length;
  analysis.counts.executedSteps = analysis.summary.executedSteps;
  finalize(analysis.summary, true);
  WORKOUT_STEP_PURPOSES.forEach(purpose => finalize(analysis.byPurpose[purpose], true));
  return analysis;
}

function addSummary(total: WorkoutAnalysisSummaryV1, next: WorkoutAnalysisSummaryV1): void {
  total.executedSteps = safeCount(total.executedSteps + next.executedSteps);
  for (const field of ['exactSteps', 'estimatedSteps', 'unknownSteps'] as const)
    total.duration[field] = safeCount(total.duration[field] + next.duration[field]);
  total.duration.exactSubtotalSeconds = finite(total.duration.exactSubtotalSeconds + next.duration.exactSubtotalSeconds);
  if (next.duration.estimatedSubtotalRange)
    total.duration.estimatedSubtotalRange = addRange(total.duration.estimatedSubtotalRange, next.duration.estimatedSubtotalRange);
  for (const field of ['exactSteps', 'unknownSteps'] as const)
    total.distance[field] = safeCount(total.distance[field] + next.distance[field]);
  total.distance.exactSubtotalMeters = finite(total.distance.exactSubtotalMeters + next.distance.exactSubtotalMeters);
}
/** Caller selects unique recipes and owns lifecycle/completion/date rules. A partial scan cannot yield a complete total. */
export function aggregateWorkoutAnalysesV1(
  analyses: readonly WorkoutAnalysisV1[], options: { sourceComplete: boolean },
): WorkoutAnalysisAggregateV1 {
  const result: WorkoutAnalysisAggregateV1 = { version: 1, workoutCount: analyses.length,
    sourceComplete: options.sourceComplete, counts: { structuralNodes: 0, definedSteps: 0, executedSteps: 0 },
    summary: emptySummary(), byPurpose: emptyPurposes() };
  for (const analysis of analyses) {
    for (const field of ['structuralNodes', 'definedSteps', 'executedSteps'] as const)
      result.counts[field] = safeCount(result.counts[field] + analysis.counts[field]);
    addSummary(result.summary, analysis.summary);
    WORKOUT_STEP_PURPOSES.forEach(purpose => addSummary(result.byPurpose[purpose], analysis.byPurpose[purpose]));
  }
  finalize(result.summary, options.sourceComplete);
  WORKOUT_STEP_PURPOSES.forEach(purpose => finalize(result.byPurpose[purpose], options.sourceComplete));
  return result;
}
