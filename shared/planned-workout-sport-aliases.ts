import { ActivityTypes } from '@sports-alliance/sports-lib';
import { CompatibleTrainingActivityTypes as Refined } from './activity-type-compatibility';

export type PlannedWorkoutSportAliasProvider = 'suunto' | 'garmin' | 'coros' | 'wahoo';

/** Approved planning aliases into existing tested delivery profiles. These do
 * not declare native provider support or change recorded-activity import maps.
 * The authored sport stays on the QS recipe and in its approval digest. */
export const PLANNED_WORKOUT_SPORT_ALIASES_V1: ReadonlyArray<{
  sport: ActivityTypes;
  suunto: ActivityTypes;
  garmin: ActivityTypes;
  coros: ActivityTypes | null;
  wahoo: ActivityTypes;
}> = [
  ...[Refined.RoadRunning, Refined.TrackRunning, Refined.UltraRunning, Refined.CrosscountryRunning,
    Refined.IndoorTrackRunning, Refined.ObstacleRacing].map(sport => ({ sport,
    suunto: ActivityTypes.Running, garmin: ActivityTypes.Running, coros: ActivityTypes.Running, wahoo: ActivityTypes.Running })),
  { sport: Refined.VerticalRunning, suunto: ActivityTypes.TrailRunning, garmin: ActivityTypes.Running,
    coros: ActivityTypes.TrailRunning, wahoo: ActivityTypes.TrailRunning },
  { sport: ActivityTypes.IndoorRunning, suunto: ActivityTypes.Treadmill, garmin: ActivityTypes.Running,
    coros: ActivityTypes.Running, wahoo: ActivityTypes.Treadmill },
  { sport: ActivityTypes.VirtualRunning, suunto: ActivityTypes.Treadmill, garmin: ActivityTypes.Running,
    coros: ActivityTypes.Running, wahoo: ActivityTypes.VirtualRunning },
  ...[Refined.RoadCycling, Refined.GravelCycling, Refined.TrackCycling, Refined.Cyclocross,
    Refined.RecumbentCycling, ActivityTypes.Velomobile, Refined.BMX, Refined.Kickbiking].map(sport => ({ sport,
    suunto: ActivityTypes.Cycling, garmin: ActivityTypes.Cycling, coros: ActivityTypes.Cycling, wahoo: ActivityTypes.Cycling })),
  ...[Refined.LesMillsRPM, Refined.LesMillsSPRINT, Refined.LesMillsTheTrip].map(sport => ({ sport,
    suunto: ActivityTypes.IndoorCycling, garmin: ActivityTypes.Cycling, coros: ActivityTypes.Cycling, wahoo: ActivityTypes.IndoorCycling })),
  { sport: ActivityTypes.VirtualCycling, suunto: ActivityTypes.IndoorCycling, garmin: ActivityTypes.Cycling,
    coros: ActivityTypes.Cycling, wahoo: ActivityTypes.VirtualCycling },
  { sport: Refined.IndoorHandCycle, suunto: ActivityTypes.Handcycle, garmin: ActivityTypes.Cycling,
    coros: ActivityTypes.Cycling, wahoo: ActivityTypes.Handcycle },
  { sport: Refined.MountainBikeOrienteering, suunto: ActivityTypes.MountainBiking, garmin: ActivityTypes.Cycling,
    coros: ActivityTypes.Cycling, wahoo: ActivityTypes.MountainBiking },
  ...[Refined.EMountainBiking, Refined.EEnduroMTB].map(sport => ({ sport,
    suunto: ActivityTypes.EBiking, garmin: ActivityTypes.Cycling, coros: ActivityTypes.Cycling, wahoo: ActivityTypes.EBiking })),
  ...[ActivityTypes['Enduro MTB'], ActivityTypes.DownhillCycling].map(sport => ({ sport,
    suunto: ActivityTypes.MountainBiking, garmin: ActivityTypes.Cycling, coros: ActivityTypes.Cycling, wahoo: ActivityTypes.MountainBiking })),
  ...[Refined.SpeedWalking, ActivityTypes.NordicWalking, Refined.IndoorWalking].map(sport => ({ sport,
    suunto: ActivityTypes.Walking, garmin: ActivityTypes.Walking, coros: null, wahoo: ActivityTypes.Walking })),
  { sport: ActivityTypes.Trekking, suunto: ActivityTypes.Hiking, garmin: ActivityTypes.Hiking,
    coros: null, wahoo: ActivityTypes.Hiking },
];

export function plannedWorkoutSportAliasV1(provider: PlannedWorkoutSportAliasProvider, sport: ActivityTypes): ActivityTypes {
  return PLANNED_WORKOUT_SPORT_ALIASES_V1.find(alias => alias.sport === sport)?.[provider] ?? sport;
}

export function plannedWorkoutAliasedSportsV1(provider: PlannedWorkoutSportAliasProvider): ActivityTypes[] {
  return PLANNED_WORKOUT_SPORT_ALIASES_V1.filter(alias => alias[provider] !== null).map(alias => alias.sport);
}
