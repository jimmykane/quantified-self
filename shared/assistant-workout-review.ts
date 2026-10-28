import { ActivityTypes } from '@sports-alliance/sports-lib';
import { parseWorkoutStructureV1, type WorkoutNodeV1, type WorkoutStructureV1 } from './planned-workout';

/** First-party review only. Entity IDs, delivery authority and provider artifacts never enter this projection. */
export interface AssistantWorkoutSnapshot {
  title: string;
  localDate: string;
  destination: string;
  lifecycle: 'planned' | 'skipped' | 'deleted';
  structure: WorkoutStructureV1;
}

export interface AssistantWorkoutReview {
  index: number;
  before: AssistantWorkoutSnapshot | null;
  after: AssistantWorkoutSnapshot | null;
  compatibility: Array<{
    provider: 'garmin' | 'coros' | 'wahoo' | 'suunto';
    before: 'exact' | 'degraded' | 'unsupported' | null;
    after: 'exact' | 'degraded' | 'unsupported' | null;
    issues: string[];
  }>;
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).length === expected.length
  && expected.every(key => Object.prototype.hasOwnProperty.call(v, key));
const string = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
const mappingLevel = (v: unknown) => v === null || v === 'exact' || v === 'degraded' || v === 'unsupported';
function snapshot(v: unknown): v is AssistantWorkoutSnapshot | null {
  if (v === null) return true;
  if (!record(v) || !keys(v, ['title', 'localDate', 'destination', 'lifecycle', 'structure'])
    || !string(v.title, 120) || !string(v.destination, 160)
    || !['planned', 'skipped', 'deleted'].includes(String(v.lifecycle))
    || typeof v.localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.localDate)) return false;
  try {
    if (new Date(`${v.localDate}T00:00:00Z`).toISOString().slice(0, 10) !== v.localDate) return false;
    const structure = parseWorkoutStructureV1(v.structure);
    // Strength's compatibility projection is insufficient for a complete prescription review.
    return structure.sport !== ActivityTypes.StrengthTraining && equalWorkoutReviewValue(structure, v.structure);
  } catch { return false; }
}

export function isAssistantWorkoutReviews(v: unknown): v is AssistantWorkoutReview[] {
  if (!Array.isArray(v) || v.length > 25) return false;
  const indices = new Set<number>();
  return v.every(review => {
    if (!record(review) || !keys(review, ['index', 'before', 'after', 'compatibility'])
      || !Number.isInteger(review.index) || Number(review.index) < 0 || Number(review.index) > 24
      || indices.has(Number(review.index)) || !snapshot(review.before) || !snapshot(review.after)
      || (review.before === null && review.after === null) || !Array.isArray(review.compatibility)
      || review.compatibility.length !== 4) return false;
    indices.add(Number(review.index));
    const providers = new Set<string>();
    return review.compatibility.every(value => {
      if (!record(value) || !keys(value, ['provider', 'before', 'after', 'issues'])
        || !['garmin', 'coros', 'wahoo', 'suunto'].includes(String(value.provider))
        || providers.has(String(value.provider))
        || !mappingLevel(value.before) || !mappingLevel(value.after)
        || (value.before === null) !== (review.before === null)
        || (value.after === null) !== (review.after === null)
        || !Array.isArray(value.issues) || value.issues.length > 20 || !value.issues.every(issue => string(issue, 500))) return false;
      providers.add(String(value.provider));
      return true;
    });
  });
}

/** Compare exact authored values, independently of display rounding or object key order. */
export function equalWorkoutReviewValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => equalWorkoutReviewValue(value, b[index]));
  if (record(a) && record(b)) return Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(key => Object.prototype.hasOwnProperty.call(b, key) && equalWorkoutReviewValue(a[key], b[key]));
  return false;
}

export interface AssistantWorkoutNodeChange {
  id: string;
  before: WorkoutNodeV1 | null;
  after: WorkoutNodeV1 | null;
  beforePosition: string | null;
  afterPosition: string | null;
  fields: string[];
}

export function diffAssistantWorkoutNodes(before: WorkoutStructureV1 | null, after: WorkoutStructureV1 | null): AssistantWorkoutNodeChange[] {
  const flatten = (recipe: WorkoutStructureV1 | null) => new Map((recipe?.nodes ?? []).flatMap((node, index) => [
    { node, parent: null as string | null, position: `${index + 1}` },
    ...(node.kind === 'repeat' ? node.steps.map((step, child) => ({ node: step as WorkoutNodeV1, parent: node.id, position: `${index + 1}.${child + 1}` })) : []),
  ]).map(entry => [entry.node.id, entry]));
  const prior = flatten(before), next = flatten(after);
  // Compare relative order of surviving IDs. Insertion/deletion must not mark every following step as moved.
  const moved = new Set<string>();
  for (const parent of new Set([...prior.values(), ...next.values()].map(entry => entry.parent))) {
    const a = [...prior.values()].filter(entry => entry.parent === parent && next.get(entry.node.id)?.parent === parent).map(entry => entry.node.id);
    const b = [...next.values()].filter(entry => entry.parent === parent && prior.get(entry.node.id)?.parent === parent).map(entry => entry.node.id);
    a.forEach((id, index) => { if (b[index] !== id) moved.add(id); });
  }
  // Proposed order first; removed nodes retain their original order afterwards.
  return [...next.keys(), ...[...prior.keys()].filter(id => !next.has(id))].flatMap(id => {
    const a = prior.get(id), b = next.get(id);
    const fields: string[] = [];
    if (!a) fields.push('Added');
    else if (!b) fields.push('Removed');
    else {
      if (a.node.kind !== b.node.kind) fields.push('Node type');
      for (const [key, label] of [['purpose', 'Purpose'], ['ending', 'Duration / ending'], ['targets', 'Targets'], ['note', 'Note'], ['count', 'Repeat count']] as const) {
        if (!equalWorkoutReviewValue((a.node as unknown as Record<string, unknown>)[key], (b.node as unknown as Record<string, unknown>)[key])) fields.push(label);
      }
      if (a.parent !== b.parent || moved.has(id)) fields.push('Order / repeat placement');
    }
    return fields.length ? [{ id, before: a?.node ?? null, after: b?.node ?? null,
      beforePosition: a?.position ?? null, afterPosition: b?.position ?? null, fields }] : [];
  });
}

/** A deliberately narrow deterministic safeguard for a single duration-only recovery request. */
export function assistantRecoveryDurationSeconds(prompt: string): number | null {
  const match = /^(?:please\s+)?(?:change|set|make)\s+(?:(?:the|all)\s+)?recover(?:y|ies)(?:\s+(?:steps|intervals))?\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\.?\s*$/iu.exec(prompt.trim());
  return match ? Number(match[1]) : null;
}

export function assertAssistantRecoveryDurationEdit(prompt: string, reviews: AssistantWorkoutReview[]): void {
  const seconds = assistantRecoveryDurationSeconds(prompt);
  if (seconds === null) return;
  assertAssistantRecoveryDurationSeconds(seconds, reviews);
}

export function assertAssistantRecoveryDurationSeconds(seconds: number, reviews: AssistantWorkoutReview[]): void {
  const review = reviews.length === 1 ? reviews[0] : null;
  if (!Number.isFinite(seconds) || seconds <= 0 || !review?.before || !review.after) throw new Error('A recovery duration edit requires one complete existing workout review.');
  const expected: AssistantWorkoutSnapshot = JSON.parse(JSON.stringify(review.before));
  let count = 0;
  for (const node of expected.structure.nodes) for (const step of node.kind === 'step' ? [node] : node.steps) {
    if (step.purpose === 'recovery' && step.ending.kind === 'time') { step.ending.seconds = seconds; count++; }
  }
  if (!count || !equalWorkoutReviewValue(expected, review.after)) throw new Error('Change only the timed recovery steps; preserve every other field, target, note, ID and order.');
}
