import { ActivityTypes } from '@sports-alliance/sports-lib';
import { CompatibleTrainingActivityTypes as Refined } from './activity-type-compatibility';

export type PlannedWorkoutSportAliasProvider = 'suunto' | 'garmin' | 'coros' | 'wahoo';

/** Approved planning aliases into existing tested delivery profiles. These do
 * not declare native provider support or change recorded-activity import maps.
 * The authored sport stays on the QS recipe and in its approval digest. */
export const PLANNED_WORKOUT_SPORT_ALIASES_V1: ReadonlyArray<{
  sport: ActivityTypes;
  suunto: ActivityTypes | null;
  garmin: ActivityTypes | null;
  coros: ActivityTypes | null;
  wahoo: ActivityTypes | null;
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
  // Suunto retains generic interval delivery. Other providers require the full
  // matching exercise prescription through their existing strength workflow.
  { sport: ActivityTypes.WeightTraining, suunto: ActivityTypes.StrengthTraining,
    garmin: ActivityTypes.StrengthTraining, coros: ActivityTypes.StrengthTraining, wahoo: ActivityTypes.StrengthTraining },
  ...[ActivityTypes.CoreTraining, ActivityTypes.LesMillsCore, ActivityTypes.LesMillsGritStrength,
    Refined.LesMillsBODYPUMP].map(sport => ({ sport, suunto: ActivityTypes.StrengthTraining,
    garmin: ActivityTypes.StrengthTraining, coros: ActivityTypes.StrengthTraining, wahoo: ActivityTypes.StrengthTraining })),
  ...[ActivityTypes.Kettlebell, ActivityTypes.Calisthenics].map(sport => ({ sport, suunto: sport,
    garmin: ActivityTypes.StrengthTraining, coros: ActivityTypes.StrengthTraining, wahoo: ActivityTypes.StrengthTraining })),
  { sport: ActivityTypes.VirtualRowing, suunto: ActivityTypes.IndoorRowing,
    garmin: ActivityTypes.IndoorRowing, coros: null, wahoo: ActivityTypes.IndoorRowing },
  { sport: ActivityTypes.FlexibilityTraining, suunto: ActivityTypes.Stretching,
    garmin: null, coros: null, wahoo: null },
  { sport: ActivityTypes.EllipticalTrainer, suunto: ActivityTypes.Crosstrainer,
    garmin: ActivityTypes.CardioTraining, coros: null, wahoo: ActivityTypes.EllipticalTrainer },
  { sport: ActivityTypes.Breathwork, suunto: ActivityTypes.Meditation,
    garmin: null, coros: null, wahoo: null },
  { sport: ActivityTypes.Crosstrainer, suunto: ActivityTypes.Crosstrainer,
    garmin: ActivityTypes.CardioTraining, coros: null, wahoo: ActivityTypes.EllipticalTrainer },
  ...[ActivityTypes.Crossfit, ActivityTypes['Circuit Training'], ActivityTypes.Aerobics,
    ActivityTypes.HIIT, ActivityTypes.AMRAP, ActivityTypes.EMOM, ActivityTypes.Tabata].map(sport => ({ sport,
    suunto: ([ActivityTypes.Crossfit, ActivityTypes['Circuit Training'], ActivityTypes.Aerobics] as ActivityTypes[])
      .includes(sport) ? sport : null,
    garmin: ActivityTypes.CardioTraining, coros: null, wahoo: ActivityTypes.CardioTraining })),
];

export function plannedWorkoutSportAliasV1(provider: PlannedWorkoutSportAliasProvider, sport: ActivityTypes): ActivityTypes {
  return PLANNED_WORKOUT_SPORT_ALIASES_V1.find(alias => alias.sport === sport)?.[provider] ?? sport;
}

export function plannedWorkoutAliasedSportsV1(provider: PlannedWorkoutSportAliasProvider): ActivityTypes[] {
  return PLANNED_WORKOUT_SPORT_ALIASES_V1.filter(alias => alias[provider] !== null).map(alias => alias.sport);
}
