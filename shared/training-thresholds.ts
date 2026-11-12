import { TRAINING_LOAD_THRESHOLD_KEYS, validTrainingLoadPolicy,
  type TrainingLoadPolicy, type TrainingLoadThresholds } from './training-load-policy';

export type TrainingThresholdChanges = { [K in keyof TrainingLoadThresholds]?: TrainingLoadThresholds[K] | null };
export interface TrainingThresholdValue {
  value: number;
  unit: 'watt' | 'bpm' | 'm/s';
  displayValue: string;
  displayUnit: string;
}
export type TrainingThresholdValues = Record<'functionalThresholdPower' | 'lactateThresholdHR' | 'swimThresholdSpeed', TrainingThresholdValue | null>
  & Partial<Record<'runningThresholdSpeed' | 'restingHeartRate' | 'maxHeartRate', TrainingThresholdValue | null>>
  & { hrAlgorithm?: TrainingLoadThresholds['hrAlgorithm'] | null };
export interface TrainingThresholdReview {
  family: string;
  familyLabel: string;
  before: TrainingThresholdValues;
  after: TrainingThresholdValues;
}
/** Strict app review projection; private source and policy fields are never accepted. */
export function isTrainingThresholdReview(value: unknown): value is TrainingThresholdReview {
  const record = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input);
  if (!record(value) || Object.keys(value).sort().join(',') !== 'after,before,family,familyLabel'
    || typeof value.family !== 'string' || !value.family.length || value.family.length > 64
    || typeof value.familyLabel !== 'string' || !value.familyLabel.length || value.familyLabel.length > 100) return false;
  const units = { functionalThresholdPower: 'watt', lactateThresholdHR: 'bpm', swimThresholdSpeed: 'm/s', runningThresholdSpeed: 'm/s', restingHeartRate: 'bpm', maxHeartRate: 'bpm' } as const;
  // Retain saved reviews from before optional pace and HR formula support.
  const keys = TRAINING_LOAD_THRESHOLD_KEYS.filter(key => ['functionalThresholdPower', 'lactateThresholdHR', 'swimThresholdSpeed'].includes(key)
    || record(value.before) && key in value.before || record(value.after) && key in value.after);
  return [value.before, value.after].every(side => record(side)
    && Object.keys(side).sort().join(',') === [...keys].sort().join(',')
    && keys.every(key => {
      const quantity = side[key];
      if (key === 'hrAlgorithm') return quantity === null || quantity === 'BANISTER' || quantity === 'THRESHOLD';
      return quantity === null || record(quantity)
        && Object.keys(quantity).sort().join(',') === 'displayUnit,displayValue,unit,value'
        && typeof quantity.value === 'number' && Number.isFinite(quantity.value) && quantity.value > 0
        && quantity.unit === units[key] && typeof quantity.displayValue === 'string' && quantity.displayValue.length <= 80
        && typeof quantity.displayUnit === 'string' && quantity.displayUnit.length <= 40;
    }));
}

/** A threshold edit cannot change method/inclusion or rewrite an immutable historical revision. */
export function applyTrainingThresholdChanges(family: unknown, current: TrainingLoadPolicy,
  changes: TrainingThresholdChanges): TrainingLoadPolicy {
  if (!Object.keys(changes).length || Object.keys(changes).some(key =>
    !TRAINING_LOAD_THRESHOLD_KEYS.includes(key as keyof TrainingLoadThresholds))) throw new Error('Choose explicit threshold changes.');
  const next = { ...current };
  for (const key of TRAINING_LOAD_THRESHOLD_KEYS) {
    if (changes[key] === null) delete next[key];
    else if (changes[key] !== undefined) Object.assign(next, { [key]: changes[key] });
  }
  if (!validTrainingLoadPolicy(family, next)) throw new Error('Use positive finite thresholds for the selected sport family.');
  return next;
}
