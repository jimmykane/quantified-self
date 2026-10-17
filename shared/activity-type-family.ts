import { ActivityTypeGroups, ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import {
  CompatibleTrainingActivityTypes,
  resolveCompatibleActivityType,
  WALKING_ACTIVITY_TYPE_GROUP,
} from './activity-type-compatibility';

export type ActivityTypeFilterFamily = 'running' | 'cycling' | 'walking-hiking';

const REFINED_RUNNING_TYPES = new Set<ActivityTypes>([
  CompatibleTrainingActivityTypes.RoadRunning,
  CompatibleTrainingActivityTypes.IndoorTrackRunning,
  CompatibleTrainingActivityTypes.VerticalRunning,
  CompatibleTrainingActivityTypes.TrackRunning,
  CompatibleTrainingActivityTypes.UltraRunning,
  CompatibleTrainingActivityTypes.CrosscountryRunning,
  CompatibleTrainingActivityTypes.ObstacleRacing,
]);
const REFINED_CYCLING_TYPES = new Set<ActivityTypes>([
  CompatibleTrainingActivityTypes.RoadCycling,
  CompatibleTrainingActivityTypes.GravelCycling,
  CompatibleTrainingActivityTypes.TrackCycling,
  CompatibleTrainingActivityTypes.Cyclocross,
  CompatibleTrainingActivityTypes.RecumbentCycling,
  CompatibleTrainingActivityTypes.IndoorHandCycle,
  CompatibleTrainingActivityTypes.EMountainBiking,
  CompatibleTrainingActivityTypes.MountainBikeOrienteering,
  CompatibleTrainingActivityTypes.EEnduroMTB,
  CompatibleTrainingActivityTypes.BMX,
  CompatibleTrainingActivityTypes.Kickbiking,
  CompatibleTrainingActivityTypes.LesMillsRPM,
  CompatibleTrainingActivityTypes.LesMillsSPRINT,
  CompatibleTrainingActivityTypes.LesMillsTheTrip,
]);
const WALKING_HIKING_TYPES = new Set<ActivityTypes>([
  ActivityTypes.Walking,
  ActivityTypes.NordicWalking,
  ActivityTypes.Hiking,
  ActivityTypes.Trekking,
  CompatibleTrainingActivityTypes.IndoorWalking,
  CompatibleTrainingActivityTypes.SpeedWalking,
]);

export function isActivityTypeInFilterFamily(value: unknown, family: ActivityTypeFilterFamily): boolean {
  const type = resolveCompatibleActivityType(value);
  if (!type) return false;
  const group = ActivityTypesHelper.getActivityGroupForActivityType(type);
  if (family === 'running') {
    return group === ActivityTypeGroups.RunningGroup
      || group === ActivityTypeGroups.TrailRunningGroup
      || REFINED_RUNNING_TYPES.has(type);
  }
  if (family === 'cycling') {
    return group === ActivityTypeGroups.CyclingGroup
      || group === ActivityTypeGroups.MountainBikingGroup
      || REFINED_CYCLING_TYPES.has(type);
  }
  return String(group) === WALKING_ACTIVITY_TYPE_GROUP || WALKING_HIKING_TYPES.has(type);
}

export function isRunningFamilyActivityType(value: unknown): boolean {
  return isActivityTypeInFilterFamily(value, 'running');
}

/** Offer only names supported by the installed catalog, never a future enum bridge. */
export function getCanonicalActivityTypesForFilterFamily(family: ActivityTypeFilterFamily): ActivityTypes[] {
  return ActivityTypesHelper.getActivityTypesAsUniqueArray()
    .map(value => ActivityTypesHelper.resolveActivityType(value))
    .filter((type): type is ActivityTypes => Boolean(type) && isActivityTypeInFilterFamily(type, family));
}
