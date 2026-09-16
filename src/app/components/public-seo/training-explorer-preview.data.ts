import { DataDistance, DataDuration, DataPowerTrainingStressScore, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { formatUnitAwareDataValue } from '@shared/unit-aware-display';
import type { TrainingReadinessTrendPointViewModel } from '../../helpers/training-readiness.helper';
import type { TrainingPowerSystemsTrendViewModel } from '../../helpers/training-power-systems.helper';
import type { TrainingDurabilityTrajectoryViewModel } from '../../helpers/training-durability-view.helper';
import type { TrainingBuildMetricRowViewModel } from '../shared/training-summary/training-build-metrics.component';
import type { TrainingMixDetailsViewModel } from '../shared/training-summary/training-mix-details.component';

// Synthetic, deterministic presentation fixtures, not an export of an athlete's account.
// Inspired by mixed running/cycling/open-water training. No user, event, route or source IDs.
const DAY = 86_400_000;
const END = Date.UTC(2026, 7, 31);
export const TRAINING_PREVIEW_SPORTS = ['Running', 'Cycling', 'Swimming'] as const;
export type TrainingPreviewSport = typeof TRAINING_PREVIEW_SPORTS[number];

export const TRAINING_PREVIEW_READINESS: readonly TrainingReadinessTrendPointViewModel[] =
  [72, 68, 61, 55, 64, 76, 79, 73, 59, 52, 62, 69, 74, 78].map((score, index) => ({
    dayMs: END - (13 - index) * DAY,
    score,
    statusLabel: score >= 75 ? 'Ready' : score >= 55 ? 'Mixed' : 'Recover',
    confidence: 'high', availableSignalCount: 4, baselineEvidenceCount: 28,
  }));

export function buildTrainingPreviewMix(
  sport: TrainingPreviewSport,
  units: UserUnitSettingsInterface | null = null,
): TrainingMixDetailsViewModel {
  const fixtures = {
    Running: { workouts: 12, usualWorkouts: 10, time: 41400, usualTime: 36000, zones: [72, 22, 6], usual: [67, 25, 8] },
    Cycling: { workouts: 16, usualWorkouts: 14, time: 111600, usualTime: 97200, zones: [68, 25, 7], usual: [75, 20, 5] },
    Swimming: { workouts: 7, usualWorkouts: 5, time: 20700, usualTime: 15300, zones: [81, 16, 3], usual: [84, 14, 2] },
  }[sport];
  const duration = (value: number) => formatUnitAwareDataValue(DataDuration.type, value, units) ?? '—';
  return {
    label: sport,
    activityCountText: String(fixtures.workouts), baselineActivityCountText: String(fixtures.usualWorkouts),
    durationText: duration(fixtures.time), baselineDurationText: duration(fixtures.usualTime),
    zones: (['Easy', 'Moderate', 'Hard'] as const).map((label, i) => ({
      label, currentPercent: fixtures.zones[i], baselinePercent: fixtures.usual[i],
      currentText: `${fixtures.zones[i]}%`, baselineText: `${fixtures.usual[i]}%`,
    })),
    contexts: [], intensityEvidenceText: null,
    guidance: {
      conclusionText: `Your ${sport.toLowerCase()} intensity mix is close to your usual balance.`,
      evidenceText: 'Recorded zone time only; workouts without usable zones are left out.',
      nextStepText: null,
    },
  };
}

export function buildTrainingPreviewBuildRows(units: UserUnitSettingsInterface | null = null): TrainingBuildMetricRowViewModel[] {
  const stat = (type: string, value: number) => formatUnitAwareDataValue(type, value, units) ?? '—';
  const metric = (label: string, type: string, current: number, benchmark: number): TrainingBuildMetricRowViewModel => ({
    label, currentText: stat(type, current), benchmarkText: stat(type, benchmark),
    deltaText: `${current >= benchmark ? '+' : '−'}${stat(type, Math.abs(current - benchmark))}`,
    deltaTone: 'neutral', isIntensity: false,
  });
  return [
    metric('Distance', DataDistance.type, 812000, 746000),
    metric('Time', DataDuration.type, 216000, 198000),
    { label: 'Workouts', currentText: '32', benchmarkText: '29', deltaText: '+3', deltaTone: 'neutral', isIntensity: false },
    { label: 'Active weeks', currentText: '8 / 8', benchmarkText: '8 / 8', deltaText: '—', isIntensity: false },
    metric('Longest workout', DataDuration.type, 16200, 14400),
    metric('TSS', DataPowerTrainingStressScore.type, 2310, 2180),
    { label: 'Intensity mix', currentText: '72% / 22% / 6%', benchmarkText: '75% / 20% / 5%', deltaText: '—', isIntensity: true },
  ];
}

export const TRAINING_PREVIEW_POWER: readonly TrainingPowerSystemsTrendViewModel[] = [
  { key: 'criticalPowerWatts', label: 'Critical power', unit: 'W', values: [219, 222, 220, 225, null, 228, 232, 230, 236, 234, 238, 241] },
  { key: 'wPrimeJoules', label: 'W′', unit: 'kJ', values: [14.8, 15.2, null, 15.1, null, 15.6, 15.4, 16, 15.7, 16.2, 16, 16.4] },
  { key: 'maximumPowerWatts', label: 'Maximum power', unit: 'W', values: [812, 824, null, 818, null, 839, 831, 846, 842, 860, 855, 868] },
].map(({ key, label, unit, values }) => ({
  key: key as TrainingPowerSystemsTrendViewModel['key'],
  label, unit: unit as TrainingPowerSystemsTrendViewModel['unit'],
  rangeStartDayMs: END - 83 * DAY, rangeEndDayMs: END,
  points: values.map((value, i) => ({
    dayMs: END - (11 - i) * 7 * DAY, value, isCurrent: i === 11,
    statusText: value === null ? 'Not enough evidence' : 'Ready',
  })),
}));

export const TRAINING_PREVIEW_DURABILITY: TrainingDurabilityTrajectoryViewModel = {
  contextKey: 'cycling|power|W|-|-', contextLabel: 'Cycling · Power',
  title: 'Cycling durability trend', metricLabel: 'Aerobic decoupling',
  metricDescription: 'How power relative to heart rate changes between the two halves of comparable steady rides.',
  eligibilityDescription: 'Only eligible long, steady sessions contribute to the line.',
  sourceActivityLabel: 'Power recorded',
  barExplanation: 'Bars show rides with recorded power; labels show eligible / power-recorded rides.',
  activityCountSummary: '36 power-recorded rides · 20 eligible',
  exclusionSummary: '16 rides excluded for variable effort.',
  unitLabel: '%', noEligibleWeekCount: 2, unavailableMetricWeekCount: 0,
  points: [7.8, 9.4, 6.2, null, 7.1, 5.8, 6.5, 4.9, null, 5.4, 4.6, 4.8].map((value, i) => ({
    weekStartDayMs: END - (11 - i) * 7 * DAY,
    weekEndDayMs: END - (11 - i) * 7 * DAY + 6 * DAY,
    value, candidateActivityCount: 3, sourceActivityCount: 3, missingEvidenceActivityCount: 0,
    eligibleSampleCount: value === null ? 0 : 2, hasEligibleSamples: value !== null,
    exclusionReasons: [{ reason: 'too-variable', label: 'Too variable', activityCount: value === null ? 3 : 1 }],
  })),
};
