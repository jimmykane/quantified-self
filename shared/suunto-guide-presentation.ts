import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { WorkoutStepV1, WorkoutTargetV1 } from './planned-workout';

export type SuuntoGuideLiveReadingTypeV1 = 'heartRate' | 'power' | 'pace' | 'speed' | 'cadence';
export type SuuntoGuideReadingTypeV1 = SuuntoGuideLiveReadingTypeV1 | 'strokeRate' | 'swolf';

/** Cosmetic substitutions shared by screen selection and serialization. */
export function suuntoGuideWatchTextV1(value: string): string {
  return value.replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u00a0\u202f]/g, ' ');
}

export function suuntoGuideLiveReadingsV1(sport: ActivityTypes): SuuntoGuideLiveReadingTypeV1[] {
  if (sport === ActivityTypes.StrengthTraining) return ['heartRate'];
  if ([ActivityTypes.Cycling, ActivityTypes.MountainBiking, ActivityTypes.IndoorCycling,
    ActivityTypes.EBiking, ActivityTypes.Handcycle].includes(sport)) return ['power', 'heartRate', 'speed'];
  return ['pace', 'heartRate'];
}

export function suuntoGuideMeasuredTargetV1(target: WorkoutTargetV1, sport: ActivityTypes): SuuntoGuideLiveReadingTypeV1 | null {
  // Power/cadence sensors are documented for running/cycling, not swimming/rowing.
  const hasPowerCadence = suuntoGuideLiveReadingsV1(sport)[0] === 'power'
    || [ActivityTypes.Running, ActivityTypes.TrailRunning, ActivityTypes.Treadmill].includes(sport);
  switch (target.kind) {
    case 'heart-rate': return 'heartRate';
    case 'power': return hasPowerCadence ? 'power' : null;
    case 'speed': return target.presentation === 'pace' ? 'pace' : 'speed';
    case 'cadence': return hasPowerCadence ? 'cadence' : null;
  }
}

export function isSuuntoGuideManualLapAverageV1(type: SuuntoGuideReadingTypeV1, sport: ActivityTypes): boolean {
  return type === 'pace' || type === 'strokeRate' || (type === 'swolf' && sport === ActivityTypes.Swimming)
    || (type === 'power' && suuntoGuideLiveReadingsV1(sport)[0] === 'power');
}

/** Share current compatibility/screen selection. Historical v5/v6 serializers
 * explicitly disable SWOLF to preserve immutable delivery/approval digests. */
export function suuntoGuideOptionalReadingsV1(step: WorkoutStepV1, sport: ActivityTypes,
  includePoolSwolf = true): SuuntoGuideReadingTypeV1[] {
  if (step.ending.kind === 'manual' && step.targets.length === 0 && step.note
    && Array.from(suuntoGuideWatchTextV1(step.note)).length > 40) return [];
  const prescribedFields = Math.max(1, (step.ending.kind === 'manual' ? 0 : 1)
    + step.targets.length + (step.note ? 1 : 0));
  const defaults: SuuntoGuideReadingTypeV1[] = suuntoGuideLiveReadingsV1(sport)[0] === 'power'
    ? ['power', 'heartRate', 'cadence', 'speed']
    : sport === ActivityTypes.Swimming && includePoolSwolf ? ['pace', 'strokeRate', 'swolf', 'heartRate']
      : [ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming].includes(sport)
      ? ['pace', 'strokeRate', 'heartRate'] : suuntoGuideLiveReadingsV1(sport);
  const counterparts = step.targets.flatMap(target => {
    const type = suuntoGuideMeasuredTargetV1(target, sport);
    return type ? [type] : [];
  });
  const candidates = [...new Set<SuuntoGuideReadingTypeV1>(step.targets.length
    ? [...counterparts, 'heartRate', ...defaults] : defaults)];
  return candidates.slice(0, 5 - prescribedFields);
}
