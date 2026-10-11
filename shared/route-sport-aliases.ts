import { ActivityTypes } from '@sports-alliance/sports-lib';
import { CompatibleTrainingActivityTypes as Refined, resolveCompatibleActivityType } from './activity-type-compatibility';

// Explicit route-delivery approvals, independent of planned-workout mappings.
// Only the outbound provider profile changes; QS keeps the original route sport.
const PROVIDER_ROUTE_SPORT_ALIASES = new Map<ActivityTypes, ActivityTypes>([
  [Refined.BMX, ActivityTypes.Cycling],
  [Refined.LesMillsRPM, ActivityTypes.Cycling],
  [Refined.LesMillsSPRINT, ActivityTypes.Cycling],
  [Refined.LesMillsTheTrip, ActivityTypes.Cycling],
  [Refined.ObstacleRacing, ActivityTypes.Running],
  [Refined.VerticalRunning, ActivityTypes['Trail Running']],
  [ActivityTypes['Enduro MTB'], ActivityTypes['Mountain Biking']],
  [Refined.EEnduroMTB, ActivityTypes['Mountain Biking']],
]);

export function resolveProviderRouteSportAlias(value: unknown): ActivityTypes | null {
  const sport = resolveCompatibleActivityType(value);
  return sport ? PROVIDER_ROUTE_SPORT_ALIASES.get(sport) ?? null : null;
}
