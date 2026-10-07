import type { TrainingStressScoreEvaluations, TrainingStressScorePreference } from '@sports-alliance/sports-lib';
import { resolveTrainingDisciplineFromActivityType, type TrainingSportId } from './training-disciplines';

export const TRAINING_LOAD_METADATA_ID = 'trainingLoad';
export const TRAINING_LOAD_POLICY_VERSION = 1;
export type TrainingLoadMethod = TrainingStressScorePreference;
export interface TrainingLoadPolicy {
  method: TrainingLoadMethod;
  included: boolean;
}
export interface AppliedTrainingLoadPolicy extends TrainingLoadPolicy {
  family: TrainingSportId | null;
  revision: number;
  effectiveAtMs: number | null;
}
export interface TrainingLoadControl {
  method?: TrainingLoadMethod;
  included?: boolean;
  override?: number;
  /** Explicitly associate a retained unmatched leg with one current activity. */
  activityId?: string;
  /** Explicitly discard an unmatched leg's controls after reviewing the new legs. */
  dismissed?: boolean;
}
export interface TrainingLoadLeg {
  activityId: string | null;
  identity: { startMs: number | null; endMs: number | null; type: string; duration: number | null; distance: number | null };
  recordedTss: number | null;
  evaluations: TrainingStressScoreEvaluations | null;
  policy: AppliedTrainingLoadPolicy;
  sourceFingerprint?: string;
}
export interface TrainingLoadMetadata {
  version: 1;
  revision: number;
  excluded: boolean;
  controls: Record<string, TrainingLoadControl>;
  /** Server-owned; absent on a legacy activity edited before its first source reparse. */
  legs?: Record<string, TrainingLoadLeg>;
  /** Server-frozen pre-rewrite identities for legacy controls; never modeled as calculated candidates. */
  legacyLegs?: Record<string, TrainingLoadLeg>;
  parentFingerprint?: string;
  /** Server-owned source-write coordination; source triggers wait for final candidates. */
  sourceWritePending?: boolean;
  sourceFirstImport?: boolean;
  sourceWriteTimes?: Record<string, string>;
  sourceDigest?: string;
  sourceRevision?: number;
  loadRevision?: number;
  updatedAt?: unknown;
  /** Explicit workout reset releases retained unmatched identities. */
  resetUnmatched?: boolean;
}
export interface TrainingLoadActivity {
  id: string;
  type?: unknown;
  stats?: unknown;
  getStat?: (type: string) => { getValue(): unknown } | undefined | null | void;
}
export interface EffectiveTrainingLoad {
  score: number | null;
  status: 'available' | 'partial' | 'unavailable' | 'excluded';
  method: string | null;
  estimated: boolean;
  reasons: string[];
}
export const DEFAULT_TRAINING_LOAD_POLICY: Readonly<TrainingLoadPolicy> = { method: 'AUTOMATIC', included: true };

export function defaultAppliedTrainingLoadPolicy(type: unknown): AppliedTrainingLoadPolicy {
  return { ...DEFAULT_TRAINING_LOAD_POLICY, family: resolveTrainingDisciplineFromActivityType(type),
    revision: 0, effectiveAtMs: null };
}
export function validTrainingLoadOverride(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 9999;
}
export function isTrainingLoadMethod(value: unknown): value is TrainingLoadMethod {
  return value === 'AUTOMATIC' || value === 'HR' || value === 'MET';
}
export function recordedTrainingStressScore(source: { stats?: unknown; getStat?: TrainingLoadActivity['getStat'] }): number | null {
  const stats = source.stats && typeof source.stats === 'object' ? source.stats as Record<string, unknown> : {};
  for (const type of ['Training Stress Score', 'Power Training Stress Score']) {
    const stat = source.getStat?.(type);
    const raw = (stat ? stat.getValue() : undefined) ?? stats[type];
    const value = typeof raw === 'object' && raw !== null
      ? (raw as any).value ?? (raw as any).rawValue ?? (raw as any)._value : raw;
    const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  }
  return null;
}
const unavailable = (reason: string): EffectiveTrainingLoad => ({ score: null, status: 'unavailable', method: null,
  estimated: false, reasons: [reason] });
const excluded = (): EffectiveTrainingLoad => ({ score: 0, status: 'excluded', method: null,
  estimated: false, reasons: ['excluded-by-owner'] });

/** Unmatched saved policies/controls require an explicit owner decision, never an ordinal guess. */
export function unresolvedTrainingLoadLegs(metadata: TrainingLoadMetadata): string[] {
  if (metadata.resetUnmatched) return [];
  const legs = metadata.legs ?? {};
  const activeIds = new Set(Object.values(legs).flatMap(leg => leg.activityId ? [leg.activityId] : []));
  const associations = new Map<string, number>();
  Object.values(metadata.controls).forEach(control => {
    if (control.activityId) associations.set(control.activityId, (associations.get(control.activityId) ?? 0) + 1);
  });
  return Object.entries(legs).filter(([key, leg]) => {
    if (leg.activityId) return false;
    const control = metadata.controls[key];
    return !control?.dismissed && (!control?.activityId || !activeIds.has(control.activityId) ||
      associations.get(control.activityId) !== 1);
  }).map(([key]) => key);
}

/** The single load policy resolver used by Training builders, impact and owner UI. */
export function resolveEffectiveTrainingLoad(
  source: { stats?: unknown; getStat?: TrainingLoadActivity['getStat'] },
  metadata?: TrainingLoadMetadata | null,
  activities: readonly TrainingLoadActivity[] = [],
  activityId?: string,
): EffectiveTrainingLoad {
  if (metadata?.excluded) return excluded();
  if (metadata?.sourceWritePending) return unavailable('source-updating');
  if (metadata && unresolvedTrainingLoadLegs(metadata).length) return unavailable('activity-match-needs-review');
  const legs = metadata?.legs ?? {};
  const resolveLeg = (id: string, activity?: TrainingLoadActivity): EffectiveTrainingLoad => {
    const entry = Object.entries(legs).find(([, leg]) => leg.activityId === id);
    if (metadata?.legs && !entry) return unavailable('source-updating');
    const associated = Object.entries(metadata?.controls ?? {}).find(([, control]) => control.activityId === id);
    const key = associated?.[0] ?? entry?.[0] ?? id;
    const policy = legs[key]?.policy ?? entry?.[1].policy ?? defaultAppliedTrainingLoadPolicy(activity?.type);
    const control = metadata?.controls[key];
    if ((control?.included ?? policy.included) === false) return excluded();
    if (validTrainingLoadOverride(control?.override)) return { score: control.override, status: 'available',
      method: 'OVERRIDE', estimated: false, reasons: [] };
    const method = control?.method ?? policy.method;
    const evaluations = entry?.[1].evaluations;
    if (evaluations) {
      const result = evaluations[method === 'HR' ? 'hr' : method === 'MET' ? 'met' : 'automatic'];
      return { score: result.score, status: result.score === null ? 'unavailable' : 'available',
        method: result.method, estimated: result.estimated, reasons: [...result.reasons] };
    }
    if (method !== 'AUTOMATIC') return unavailable('reparse-required');
    const score = entry ? entry[1].recordedTss : activity ? recordedTrainingStressScore(activity) : null;
    return score === null ? unavailable('missing-tss') : { score, status: 'available', method: 'RECORDED',
      estimated: false, reasons: ['legacy-recorded-score'] };
  };
  if (activityId) return resolveLeg(activityId, activities.find(activity => activity.id === activityId));
  // Legacy workouts retain the original parent value until controlled or reparsed.
  if (!metadata || (!metadata.legs && Object.keys(metadata.controls).length === 0)) {
    const score = recordedTrainingStressScore(source);
    return score === null ? unavailable('missing-tss') : { score, status: 'available', method: 'RECORDED',
      estimated: false, reasons: ['legacy-recorded-score'] };
  }
  const ids = metadata.legs
    ? Object.values(legs).flatMap(leg => leg.activityId ? [leg.activityId] : [])
    : activities.map(activity => activity.id);
  if (!ids.length) return unavailable('missing-legs');
  const results = [...new Set(ids)].map(id => resolveLeg(id, activities.find(activity => activity.id === id)));
  if (results.every(result => result.status === 'excluded')) return excluded();
  const covered = results.filter(result => result.status === 'available');
  if (!covered.length) return unavailable(results.find(result => result.status === 'unavailable')?.reasons[0] ?? 'missing-tss');
  return { score: covered.reduce((sum, result) => sum + (result.score ?? 0), 0),
    status: results.some(result => result.status === 'unavailable') ? 'partial' : 'available',
    method: covered.length === 1 ? covered[0].method : 'SUM', estimated: covered.some(result => result.estimated),
    reasons: [...new Set(results.flatMap(result => result.reasons))] };
}

// An in-memory projection only. Symbols cannot leak through ordinary Firestore/JSON/MCP serialization.
const effectiveLoad = Symbol('effectiveTrainingLoad');
export function attachEffectiveTrainingLoad<T extends object>(source: T, load: EffectiveTrainingLoad): T {
  Object.defineProperty(source, effectiveLoad, { value: load, configurable: true });
  return source;
}
export function attachedEffectiveTrainingLoad(source: object): EffectiveTrainingLoad | undefined {
  return (source as { [effectiveLoad]?: EffectiveTrainingLoad })[effectiveLoad];
}
