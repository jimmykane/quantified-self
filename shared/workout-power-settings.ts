import { MANUAL_WORKOUT_EDITOR_SPORTS_V1, type WorkoutRelativePowerTargetV1 } from './planned-workout';
import { normalizeTrainingLocalDate } from './training-plans';
import { resolveTrainingDisciplineFromActivityType } from './training-disciplines';
import { validTrainingLoadPolicy, type TrainingLoadPolicy } from './training-load-policy';
import { trainingLoadTimeMs } from './training-load-source';

/** Private, manually confirmed planning references. Never used for recorded metrics or load calculations. */
export const WORKOUT_POWER_PROVIDERS = ['garmin', 'suunto', 'coros', 'wahoo', 'other'] as const;
export const WORKOUT_POWER_SPORTS = MANUAL_WORKOUT_EDITOR_SPORTS_V1.filter(sport => !/swim|walk|hik|trek/i.test(sport));
export const WORKOUT_POWER_PROFILE_LIMIT = 20;
export interface WorkoutPowerProfileV1 {
  sport: typeof WORKOUT_POWER_SPORTS[number];
  provider: typeof WORKOUT_POWER_PROVIDERS[number];
  source: string;
  reference: WorkoutRelativePowerTargetV1['reference'];
  referenceDate: string;
  /** Z1 starts at zero; each upper bound is exclusive. The last zone has no upper bound. */
  zoneUpperBoundsWatts: number[];
}
export interface WorkoutPowerSettingsV1 { version: 1; revision: number; profiles: WorkoutPowerProfileV1[] }
function hasASCIIControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw Error('Invalid workout power settings.');
  }
  return value as Record<string, unknown>;
}
export function parseWorkoutPowerProfileV1(value: unknown): WorkoutPowerProfileV1 {
  const p = record(value, ['sport', 'provider', 'source', 'reference', 'referenceDate', 'zoneUpperBoundsWatts']);
  const reference = record(p.reference, ['kind', 'watts']);
  const watts = reference.watts;
  if (!WORKOUT_POWER_SPORTS.includes(p.sport as WorkoutPowerProfileV1['sport'])
    || !WORKOUT_POWER_PROVIDERS.includes(p.provider as WorkoutPowerProfileV1['provider'])
    || typeof p.source !== 'string' || !p.source.trim() || p.source.trim().length > 80 || hasASCIIControlCharacter(p.source)
    || !['functional-threshold-power', 'critical-power'].includes(String(reference.kind))
    || typeof watts !== 'number' || !Number.isFinite(watts) || watts <= 0 || watts > 3000) {
    throw Error('Choose a supported sport, source and positive power reference.');
  }
  const referenceDate = normalizeTrainingLocalDate(p.referenceDate);
  const bounds = p.zoneUpperBoundsWatts;
  if (!Array.isArray(bounds) || bounds.length > 9 || bounds.some((v, i) => typeof v !== 'number'
    || !Number.isFinite(v) || v <= 0 || v > 5000 || i > 0 && v <= bounds[i - 1])) {
    throw Error('Zone upper bounds must be positive, increasing values (up to nine boundaries).');
  }
  return { sport: p.sport as WorkoutPowerProfileV1['sport'], provider: p.provider as WorkoutPowerProfileV1['provider'],
    source: p.source.trim(), reference: { kind: reference.kind as WorkoutRelativePowerTargetV1['reference']['kind'], watts },
    referenceDate, zoneUpperBoundsWatts: [...bounds] };
}
export function parseWorkoutPowerSettingsV1(value: unknown): WorkoutPowerSettingsV1 {
  if (value === undefined) return { version: 1, revision: 0, profiles: [] };
  const settings = record(value, ['version', 'revision', 'profiles']);
  if (settings.version !== 1 || !Number.isSafeInteger(settings.revision) || Number(settings.revision) < 0
    || !Array.isArray(settings.profiles) || settings.profiles.length > WORKOUT_POWER_PROFILE_LIMIT) throw Error('Invalid workout power settings.');
  const profiles = settings.profiles.map(parseWorkoutPowerProfileV1).sort((a, b) => a.sport.localeCompare(b.sport, 'en'));
  if (new Set(profiles.map(p => p.sport)).size !== profiles.length) throw Error('Choose one power source per sport.');
  return { version: 1, revision: settings.revision as number, profiles };
}

/** Private generation snapshot; never a live link or an automatically exposed MCP field. */
export interface SharedWorkoutFtpReferenceV1 {
  kind: 'training-ftp';
  sport: WorkoutPowerProfileV1['sport'];
  family: 'running' | 'cycling';
  revision: number;
  effectiveAtMs: number;
  reference: { kind: 'functional-threshold-power'; watts: number };
}
export type WorkoutPowerReferenceV1 = WorkoutPowerProfileV1 | SharedWorkoutFtpReferenceV1;
export function workoutFtpFamily(sport: unknown): 'running' | 'cycling' | null {
  const family = resolveTrainingDisciplineFromActivityType(sport);
  return family === 'running' || family === 'cycling' ? family : null;
}
/** The same dated policy already used by Training and permitted MCP threshold reads. */
export function sharedWorkoutFtpReference(sport: WorkoutPowerProfileV1['sport'], value: unknown,
  asOfMs: number): SharedWorkoutFtpReferenceV1 | null {
  const family = workoutFtpFamily(sport);
  if (!family || !WORKOUT_POWER_SPORTS.includes(sport) || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const policy = value as TrainingLoadPolicy & { revision?: number; effectiveAt?: unknown };
  const effectiveAtMs = trainingLoadTimeMs(policy.effectiveAt), watts = policy.functionalThresholdPower;
  if (!Number.isSafeInteger(asOfMs) || asOfMs < 0 || !validTrainingLoadPolicy(family, policy) || !Number.isSafeInteger(policy.revision) || Number(policy.revision) < 1
    || !Number.isSafeInteger(effectiveAtMs) || effectiveAtMs < 0 || effectiveAtMs > 8_640_000_000_000_000 || effectiveAtMs > asOfMs
    || typeof watts !== 'number' || !Number.isFinite(watts) || watts <= 0 || watts > 3000) return null;
  return { kind: 'training-ftp', sport, family, revision: policy.revision!, effectiveAtMs,
    reference: { kind: 'functional-threshold-power', watts } };
}
export function parseWorkoutPowerReferenceV1(value: unknown): WorkoutPowerReferenceV1 {
  if (!value || typeof value !== 'object' || !('kind' in value)) return parseWorkoutPowerProfileV1(value);
  const p = record(value, ['kind', 'sport', 'family', 'revision', 'effectiveAtMs', 'reference']);
  const reference = record(p.reference, ['kind', 'watts']);
  const result = sharedWorkoutFtpReference(p.sport as WorkoutPowerProfileV1['sport'], {
    method: 'AUTOMATIC', included: true, functionalThresholdPower: reference.watts,
    revision: p.revision, effectiveAt: p.effectiveAtMs,
  }, Number.MAX_SAFE_INTEGER);
  if (!result || p.kind !== 'training-ftp' || reference.kind !== 'functional-threshold-power' || result.family !== p.family)
    throw Error('Invalid shared FTP reference.');
  return result;
}
