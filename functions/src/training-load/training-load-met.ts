import { ActivityUtilities, DataDuration, DataEnergy, DataMovingTime,
  DataPause, DataTimerTime, DataWeight, EventImporterJSON, type ActivityTypes } from '@sports-alliance/sports-lib';
import type { TrainingLoadLeg } from '../../../shared/training-load-policy';

/** Recalculate only MET from source-verified saved scalar inputs. HR/power candidates and recorded data stay intact.
 * Called only for a deferred leg whose original non-MET calculation already established usable active timing.
 */
export function calculateDeferredMet(leg: TrainingLoadLeg, source: Record<string, unknown>, kilograms: number) {
  // Import persistence already canonicalizes these keys. Do not copy curves or hydrate unrelated metrics.
  const raw = (source.stats ?? {}) as Parameters<typeof EventImporterJSON.getActivityFromJSON>[0]['stats'];
  const stats = Object.fromEntries([DataEnergy, DataTimerTime, DataMovingTime, DataDuration, DataPause]
    .flatMap(Metric => raw[Metric.type] === undefined ? [] : [[Metric.type, raw[Metric.type]]]));
  stats[DataWeight.type] = kilograms;
  const activity = EventImporterJSON.getActivityFromJSON({ startDate: leg.identity.startMs!, endDate: leg.identity.endMs!,
    type: leg.identity.type as ActivityTypes, name: null, powerMeter: false, trainer: false,
    creator: { name: '', devices: [] }, stats, laps: [], streams: [], intensityZones: [], events: [] });
  return ActivityUtilities.getTrainingStressScoreEvaluations(activity).met;
}
