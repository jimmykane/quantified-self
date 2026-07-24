import {
  ActivityTypesHelper,
  DataPowerCurve,
  DataThreeDimensionalStrainEvidence,
  normalizeThreeDimensionalStrainEvidenceValue,
  type ActivityInterface,
  type ThreeDimensionalStrainEvidenceValue,
} from '@sports-alliance/sports-lib';

export type PowerSystemStrainViewStatus = 'ready' | 'unavailable' | 'legacy';

export interface PowerSystemStrainScoreViewModel {
  label: string;
  value: string;
}

export interface PowerSystemStrainFitViewModel {
  criticalPower: string;
  wPrime: string;
  maximumPower: string;
  normalizedRmse: string;
}

export interface PowerSystemStrainWorkoutViewModel {
  activityId: string;
  activityType: string;
  status: PowerSystemStrainViewStatus;
  statusText: string;
  detailText: string;
  inputText: string | null;
  score: PowerSystemStrainScoreViewModel[] | null;
  fit: PowerSystemStrainFitViewModel | null;
}

/**
 * Returns only persisted three-dimensional strain evidence. The activity stream is never read
 * here: sports-lib remains responsible for calculating and invalidating the compact stat.
 */
export function resolvePowerSystemStrainEvidence(
  activity: ActivityInterface,
): ThreeDimensionalStrainEvidenceValue | null {
  try {
    const stat = activity.getStat?.(DataThreeDimensionalStrainEvidence.type);
    const rawValue = (stat as unknown as { getValue?: () => unknown } | null | undefined)?.getValue?.();
    return normalizeThreeDimensionalStrainEvidenceValue(rawValue);
  } catch {
    return null;
  }
}

export function hasPowerSystemStrainEvidence(activities: readonly ActivityInterface[]): boolean {
  return activities.some(activity => resolvePowerSystemStrainEvidence(activity) !== null);
}

/**
 * Lets historic power-curve workouts explain that strain evidence needs a source reprocess. A
 * stat is still required to show a current result; the power curve is only a durable signal that
 * the dedicated tab can give a useful unavailable state instead of disappearing altogether.
 */
export function shouldShowPowerSystemStrain(activities: readonly ActivityInterface[]): boolean {
  return activities.some(activity =>
    resolvePowerSystemStrainEvidence(activity) !== null || hasPersistedPowerCurve(activity),
  );
}

export function buildPowerSystemStrainWorkoutViewModels(
  activities: readonly ActivityInterface[],
): PowerSystemStrainWorkoutViewModel[] {
  return activities.flatMap<PowerSystemStrainWorkoutViewModel>((activity, index) => {
    const evidence = resolvePowerSystemStrainEvidence(activity);
    if (!evidence) {
      return [{
        activityId: resolveActivityId(activity, index),
        activityType: resolveActivityType(activity),
        status: 'unavailable' as const,
        statusText: 'Unavailable',
        detailText: hasPersistedPowerSystemStrainStat(activity)
          ? 'Stored power-system strain evidence was invalid and cannot be shown. Reprocess its original source data to regenerate it.'
          : 'No power-system strain evidence is stored for this workout. It may lack qualifying power data, or its original source needs reprocessing.',
        inputText: null,
        score: null,
        fit: null,
      }];
    }

    const activityId = resolveActivityId(activity, index);
    const activityType = evidence.protocolVersion === 2
      ? evidence.activityType
      : resolveActivityType(activity, evidence.discipline);
    if (evidence.protocolVersion === 1) {
      return [{
        activityId,
        activityType,
        status: 'legacy' as const,
        statusText: 'Previous protocol',
        detailText: 'This workout was processed with an earlier strain protocol. Reprocess its original source data to update the analysis.',
        inputText: null,
        score: null,
        fit: null,
      }];
    }

    const inputText = formatInputText(evidence);
    if (!evidence.eligibility.eligible || !evidence.evidence || !evidence.fit) {
      return [{
        activityId,
        activityType,
        status: 'unavailable' as const,
        statusText: 'Unavailable',
        detailText: formatEligibilityReason(evidence.eligibility.reason),
        inputText,
        score: null,
        fit: evidence.fit ? formatFit(evidence.fit) : null,
      }];
    }

    return [{
      activityId,
      activityType,
      status: 'ready' as const,
      statusText: 'Ready',
      detailText: 'Recorded power was scored against this workout’s own fitted power-duration model.',
      inputText,
      score: [
        { label: 'Total strain', value: formatNumber(evidence.evidence.total, 1) },
        { label: 'Sustained power', value: formatNumber(evidence.evidence.criticalPower, 1) },
        { label: 'Finite capacity', value: formatNumber(evidence.evidence.wPrime, 1) },
        { label: 'Maximum power', value: formatNumber(evidence.evidence.maximumPower, 1) },
      ],
      fit: formatFit(evidence.fit),
    }];
  });
}

function hasPersistedPowerCurve(activity: ActivityInterface): boolean {
  try {
    const stat = activity.getStat?.(DataPowerCurve.type);
    const rawValue = (stat as unknown as { getValue?: () => unknown } | null | undefined)?.getValue?.();
    return Array.isArray(rawValue) && rawValue.length > 0;
  } catch {
    return false;
  }
}

function hasPersistedPowerSystemStrainStat(activity: ActivityInterface): boolean {
  try {
    const stat = activity.getStat?.(DataThreeDimensionalStrainEvidence.type);
    return stat !== null && stat !== undefined;
  } catch {
    return false;
  }
}

function resolveActivityId(activity: ActivityInterface, index: number): string {
  return `${activity.getID?.() || `workout-${index + 1}`}`;
}

function resolveActivityType(activity: ActivityInterface, fallback?: string): string {
  const rawType = typeof activity.type === 'string' ? activity.type.trim() : '';
  if (rawType) {
    try {
      return ActivityTypesHelper.resolveActivityType(rawType) || rawType;
    } catch {
      return rawType;
    }
  }
  return fallback || 'Workout';
}

function formatInputText(evidence: ThreeDimensionalStrainEvidenceValue): string {
  const { input } = evidence;
  return `${formatNumber(input.validPowerSampleCount, 0)}/${formatNumber(input.powerSampleCount, 0)} recorded power samples (${formatPercent(input.coverageRatio)}) · ${formatNumber(input.curvePointCount, 0)} curve points`;
}

function formatFit(fit: NonNullable<ThreeDimensionalStrainEvidenceValue['fit']>): PowerSystemStrainFitViewModel {
  return {
    criticalPower: `${formatNumber(fit.criticalPowerWatts, 0)} W`,
    wPrime: `${formatNumber(fit.wPrimeJoules / 1_000, 1)} kJ`,
    maximumPower: `${formatNumber(fit.maximumPowerWatts, 0)} W`,
    normalizedRmse: `${formatPercent(fit.normalizedRmse)} normalized error`,
  };
}

function formatEligibilityReason(reason: ThreeDimensionalStrainEvidenceValue['eligibility']['reason']): string {
  const labels: Record<ThreeDimensionalStrainEvidenceValue['eligibility']['reason'], string> = {
    eligible: 'The recorded power and fitted model are ready for this workout.',
    'missing-power': 'No usable recorded power was available for this workout.',
    'insufficient-coverage': 'Recorded power coverage was too incomplete for a reliable score.',
    'insufficient-curve-points': 'The power curve did not contain enough points to fit the model.',
    'insufficient-duration-range': 'The power curve did not cover the short, medium, and long durations required by the model.',
    'fit-failed': 'The power-duration model could not be fitted reliably.',
    'poor-fit': 'The fitted power-duration model was not close enough to the recorded curve.',
    'power-exceeds-maximum': 'Recorded power exceeded the fitted maximum-power boundary.',
  };
  return labels[reason];
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100, 1)}%`;
}
