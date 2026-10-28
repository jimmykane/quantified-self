import { DataDistance, DataDuration, DataSwimDistance, DistanceUnits,
  type ActivityTypes, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { isRowingWorkoutSportV1, isSwimmingWorkoutSportV1 } from './planned-workout';
import { analyzeWorkoutStructureV1, WorkoutAnalysisArithmeticError,
  type WorkoutAnalysisSummaryV1, type WorkoutDurationRangeV1 } from './planned-workout-analysis';
import { normalizeUserUnitSettings, resolveUnitAwareDisplayFromValue, resolveUnitAwareDisplayStat } from './unit-aware-display';

/** Display rounding belongs here; canonical analysis values are never rewritten. */
export function formatWorkoutAnalysisSummaryV1(
  summary: WorkoutAnalysisSummaryV1, unitSettings?: UserUnitSettingsInterface | null,
  sport?: ActivityTypes, locale?: string,
): string {
  const duration = summary.duration;
  const formatDuration = (seconds: number) => resolveUnitAwareDisplayFromValue(DataDuration.type, seconds, unitSettings)?.text;
  const formatRange = (range: WorkoutDurationRangeV1) => {
    const minimum = formatDuration(range.minimumSeconds);
    const maximum = formatDuration(range.maximumSeconds);
    return minimum && maximum ? minimum === maximum ? minimum : `${minimum}–${maximum}` : null;
  };
  const covered = duration.coveredSubtotalRange ? formatRange(duration.coveredSubtotalRange) : null;
  let durationText = 'Duration unknown';
  if (covered) {
    durationText = `${covered}${duration.estimatedSteps > 0 ? ' estimated' : duration.coverage === 'partial' ? ' timed subtotal' : ''}`;
    if (duration.unknownSteps > 0) {
      const count = new Intl.NumberFormat(locale).format(duration.unknownSteps);
      durationText += ` + ${count} step${duration.unknownSteps === 1 ? '' : 's'} with unknown duration`;
    } else if (duration.coverage === 'partial') durationText += ' (partial source)';
  }
  if (summary.earlyLapSteps > 0) {
    const count = new Intl.NumberFormat(locale).format(summary.earlyLapSteps);
    durationText += ` (prescribed limits) · ${count} step${summary.earlyLapSteps === 1 ? ' allows' : 's allow'} early Lap`;
  }
  const distance = summary.distance;
  if (distance.exactSteps === 0) return durationText;
  const display = isSwimmingWorkoutSportV1(sport)
    ? resolveUnitAwareDisplayStat(new DataSwimDistance(distance.exactSubtotalMeters), unitSettings)
    : resolveUnitAwareDisplayFromValue(DataDistance.type, distance.exactSubtotalMeters,
      isRowingWorkoutSportV1(sport) ? { ...normalizeUserUnitSettings(unitSettings), distanceUnits: DistanceUnits.Kilometers } : unitSettings);
  return display ? `${durationText} · ${display.text} ${distance.coverage === 'complete' ? 'prescribed' : 'distance subtotal'}` : durationText;
}

/** An unrepresentable total must not break otherwise valid instructions in Plans. */
export function formatWorkoutPrescriptionSummaryV1(
  recipe: unknown, unitSettings?: UserUnitSettingsInterface | null, sport?: ActivityTypes, locale?: string,
): string {
  try { return formatWorkoutAnalysisSummaryV1(analyzeWorkoutStructureV1(recipe).summary, unitSettings, sport, locale); }
  catch (error) {
    if (error instanceof WorkoutAnalysisArithmeticError) return 'Prescription totals unavailable';
    throw error;
  }
}
