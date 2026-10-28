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

// These exact approvals must precede legacy substring heuristics: "cycling",
// "enduro", "mountain" and "road" also occur in unrelated canonical names.
// Provider-specific choices stay separate; Wahoo documents Motorcycling as Biking.
const GARMIN_ROUTE_ACTIVITY_TYPE_OVERRIDES = new Map<string, string>([
  ['motorcycling', 'OTHER'],
  ['motorcycle enduro', 'OTHER'],
  ['hard enduro', 'OTHER'],
  ['mountaineering', 'HIKING'],
  ['ski mountaineering', 'OTHER'],
  ['offroad duathlon', 'OTHER'],
  ['offroad triathlon', 'OTHER'],
]);
const WAHOO_ROUTE_WORKOUT_FAMILY_OVERRIDES = new Map<string, number>([
  ['offroad duathlon', 31],
  ['offroad triathlon', 31],
]);

function normalizeRouteSportName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return (resolveCompatibleActivityType(value) || value).trim().toLowerCase();
}

export function resolveGarminRouteActivityTypeOverride(value: unknown): string | null {
  const name = normalizeRouteSportName(value);
  return name === null ? null : GARMIN_ROUTE_ACTIVITY_TYPE_OVERRIDES.get(name) ?? null;
}

export function resolveWahooRouteWorkoutFamilyOverride(value: unknown): number | null {
  const name = normalizeRouteSportName(value);
  return name === null ? null : WAHOO_ROUTE_WORKOUT_FAMILY_OVERRIDES.get(name) ?? null;
}

export function resolveProviderRouteSportAlias(value: unknown): ActivityTypes | null {
  const sport = resolveCompatibleActivityType(value);
  return sport ? PROVIDER_ROUTE_SPORT_ALIASES.get(sport) ?? null : null;
}
