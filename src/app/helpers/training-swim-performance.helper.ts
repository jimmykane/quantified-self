import { SwimPaceUnits, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { DashboardTrainingSwimPerformanceContext } from './dashboard-derived-metrics.helper';

export interface TrainingSwimChartPoint {
  weekStartMs: number;
  paceSeconds: number | null;
  distanceMeters: number;
  activityCount: number;
  swolf: number | null;
  swolfLengthCount: number;
}

export interface TrainingSwimPerformanceViewModel {
  pool: TrainingSwimChartPoint[];
  openWater: TrainingSwimChartPoint[];
  paceUnit: '/100m' | '/100yd';
  usesYards: boolean;
  hasSessions: boolean;
  hasPace: boolean;
  swolfContextText: string | null;
  latestSwolfText: string | null;
  conclusionText: string;
  evidenceText: string;
  nextStepText: string | null;
}

export function formatTrainingSwimPace(
  secondsPer100m: number | null | undefined,
  usesYards: boolean,
): string {
  if (!Number.isFinite(secondsPer100m) || (secondsPer100m as number) <= 0) {
    return '--';
  }
  const seconds = (secondsPer100m as number) * (usesYards ? 0.9144 : 1);
  const roundedSeconds = Math.round(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const remainder = roundedSeconds % 60;
  return `${minutes}:${`${remainder}`.padStart(2, '0')} ${usesYards ? '/100yd' : '/100m'}`;
}

export function buildTrainingSwimPerformanceViewModel(
  context: DashboardTrainingSwimPerformanceContext | null | undefined,
  unitSettings: UserUnitSettingsInterface | null | undefined,
): TrainingSwimPerformanceViewModel {
  const usesYards = unitSettings?.swimPaceUnits?.[0] === SwimPaceUnits.MinutesPer100Yard;
  const mapPoint = (environment: 'pool' | 'open-water'): TrainingSwimChartPoint[] => (context?.weeks || [])
    .filter(week => week.environment === environment)
    .map(week => ({
      weekStartMs: week.weekStartMs,
      paceSeconds: week.averagePaceSecondsPer100m,
      distanceMeters: week.distanceMeters,
      activityCount: week.activityCount,
      swolf: week.swolf,
      swolfLengthCount: week.swolfLengthCount,
    }))
    .sort((left, right) => left.weekStartMs - right.weekStartMs);
  const pool = mapPoint('pool');
  const openWater = mapPoint('open-water');
  const all = [...pool, ...openWater];
  const poolPaceWeekCount = pool.filter(point => point.paceSeconds !== null).length;
  const openWaterPaceWeekCount = openWater.filter(point => point.paceSeconds !== null).length;
  const latestSwolf = [...pool].reverse().find(point => point.swolf !== null) || null;
  const swolfContext = context?.swolfContext || null;
  return {
    pool,
    openWater,
    paceUnit: usesYards ? '/100yd' : '/100m',
    usesYards,
    hasSessions: all.some(point => point.activityCount > 0),
    hasPace: all.some(point => point.paceSeconds !== null),
    swolfContextText: swolfContext
      ? `${swolfContext.stroke.replace(/\b\w/g, character => character.toUpperCase())} · ${swolfContext.poolLengthMeters} m pool`
      : null,
    latestSwolfText: latestSwolf?.swolf === null || latestSwolf?.swolf === undefined
      ? null
      : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(latestSwolf.swolf),
    conclusionText: buildConclusion(poolPaceWeekCount, openWaterPaceWeekCount),
    evidenceText: buildEvidenceText(poolPaceWeekCount, openWaterPaceWeekCount),
    nextStepText: latestSwolf && swolfContext
      ? 'Use SWOLF only with the matching stroke and pool length shown below.'
      : null,
  };
}

function buildConclusion(poolPaceWeekCount: number, openWaterPaceWeekCount: number): string {
  if (poolPaceWeekCount > 0 && openWaterPaceWeekCount > 0) {
    return 'Pool and open-water pace are both available and are shown separately rather than combined.';
  }
  if (poolPaceWeekCount > 0) {
    return 'Pool pace is available; it is not combined with open-water swims.';
  }
  if (openWaterPaceWeekCount > 0) {
    return 'Open-water pace is available; it is not combined with pool swims.';
  }
  return 'No explicit swim pace is available to compare yet.';
}

function buildEvidenceText(poolPaceWeekCount: number, openWaterPaceWeekCount: number): string {
  const total = poolPaceWeekCount + openWaterPaceWeekCount;
  if (total === 0) {
    return 'Evidence quality: unavailable — only explicit recorded swim pace is used; rests are never estimated as pace.';
  }
  const parts = [
    poolPaceWeekCount > 0 ? `${poolPaceWeekCount} pool ${poolPaceWeekCount === 1 ? 'week' : 'weeks'}` : null,
    openWaterPaceWeekCount > 0 ? `${openWaterPaceWeekCount} open-water ${openWaterPaceWeekCount === 1 ? 'week' : 'weeks'}` : null,
  ].filter((part): part is string => !!part);
  return `Evidence quality: explicit pace in ${parts.join(' and ')}; rests are never estimated as pace.`;
}
