import { CompatibleTrainingActivityTypes as RefinedTypes, resolveCompatibleActivityType } from './activity-type-compatibility';
import {
  ActivityTypes,
  DataAscent,
  DataAvgStrokeDistance,
  DataCadenceAvg,
  DataDescent,
  DataDescentTime,
  DataDistance,
  DataDuration,
  DataElapsedTime,
  DataFlow,
  DataGrit,
  DataJumpCount,
  DataJumpDistanceMax,
  DataMovingTime,
  DataStrokeRateAvg,
  DataSwimDistance,
  type ActivityTypes as ActivityType,
} from '@sports-alliance/sports-lib';

export type TrainingAnalysisProfile =
  | 'endurance'
  | 'general'
  | 'pool'
  | 'open-water'
  | 'rowing'
  | 'vertical-endurance'
  | 'strength'
  | 'paddling'
  | 'mixed-gravity'
  | 'gravity';

export type TrainingSportCapability =
  | 'training-mix'
  | 'best-build'
  | 'durability'
  | 'capacity'
  | 'power-profile'
  | 'power-systems'
  | 'swim-performance';

export type TrainingSportIntensityPolicy = 'zones' | 'volume-only';
export type TrainingSportLoadPolicy = 'recorded' | 'volume-only';
export type TrainingSportDurabilityPolicy = 'supported' | 'unsupported-context' | 'omit';
export type TrainingSportDistancePolicy = 'recorded' | 'omit';

export type TrainingProfileMetricId =
  | 'distance'
  | 'moving-time'
  | 'elapsed-time'
  | 'ascent'
  | 'descent'
  | 'descent-time'
  | 'jump-count'
  | 'max-jump-distance'
  | 'grit'
  | 'flow'
  | 'pace-500m'
  | 'stroke-rate'
  | 'stroke-distance';

export type TrainingProfileMetricAggregation = 'sum' | 'mean' | 'maximum' | 'distance-weighted-pace';
export type TrainingProfileMetricUnit =
  | 'distance'
  | 'elevation'
  | 'duration'
  | 'count'
  | 'jump-distance'
  | 'score'
  | 'stroke-rate'
  | 'stroke-distance'
  | 'pace-500m';

interface TrainingProfileMetricDefinitionShape {
  id: TrainingProfileMetricId;
  label: string;
  aggregation: TrainingProfileMetricAggregation;
  unit: TrainingProfileMetricUnit;
  statTypes: readonly string[];
}

/**
 * Shared metric semantics for every Training context. Contexts opt into these
 * definitions below, while the generic builders decide only how to read a
 * declared source and aggregate it.
 */
export const TRAINING_PROFILE_METRIC_DEFINITIONS = [
  {
    id: 'distance',
    label: 'Distance',
    aggregation: 'sum',
    unit: 'distance',
    statTypes: [DataDistance.type, DataSwimDistance.type],
  },
  {
    id: 'moving-time',
    label: 'Moving time',
    aggregation: 'sum',
    unit: 'duration',
    statTypes: [DataMovingTime.type, DataDuration.type],
  },
  {
    id: 'elapsed-time',
    label: 'Elapsed time',
    aggregation: 'sum',
    unit: 'duration',
    statTypes: [DataElapsedTime.type, DataDuration.type],
  },
  {
    id: 'ascent',
    label: 'Ascent',
    aggregation: 'sum',
    unit: 'elevation',
    statTypes: [DataAscent.type],
  },
  {
    id: 'descent',
    label: 'Descent',
    aggregation: 'sum',
    unit: 'elevation',
    statTypes: [DataDescent.type],
  },
  {
    id: 'descent-time',
    label: 'Descent time',
    aggregation: 'sum',
    unit: 'duration',
    statTypes: [DataDescentTime.type],
  },
  {
    id: 'jump-count',
    label: 'Jumps',
    aggregation: 'sum',
    unit: 'count',
    statTypes: [DataJumpCount.type],
  },
  {
    id: 'max-jump-distance',
    label: 'Longest jump',
    aggregation: 'maximum',
    unit: 'jump-distance',
    statTypes: [DataJumpDistanceMax.type, ...DataJumpDistanceMax.aliases],
  },
  {
    id: 'grit',
    label: 'Average grit',
    aggregation: 'mean',
    unit: 'score',
    statTypes: [DataGrit.type],
  },
  {
    id: 'flow',
    label: 'Average flow',
    aggregation: 'mean',
    unit: 'score',
    statTypes: [DataFlow.type],
  },
  {
    id: 'pace-500m',
    label: 'Average 500 m pace',
    aggregation: 'distance-weighted-pace',
    unit: 'pace-500m',
    statTypes: [],
  },
  {
    id: 'stroke-rate',
    label: 'Average stroke rate',
    aggregation: 'mean',
    unit: 'stroke-rate',
    statTypes: [DataStrokeRateAvg.type, DataCadenceAvg.type],
  },
  {
    id: 'stroke-distance',
    label: 'Average stroke distance',
    aggregation: 'mean',
    unit: 'stroke-distance',
    statTypes: [DataAvgStrokeDistance.type],
  },
] as const satisfies readonly TrainingProfileMetricDefinitionShape[];

export type TrainingProfileMetricDefinition = typeof TRAINING_PROFILE_METRIC_DEFINITIONS[number];

interface TrainingSportContextDefinitionShape {
  id: string;
  label: string;
  activityTypes: readonly ActivityType[];
  profile: TrainingAnalysisProfile;
  intensityPolicy: TrainingSportIntensityPolicy;
  loadPolicy: TrainingSportLoadPolicy;
  durabilityPolicy: TrainingSportDurabilityPolicy;
  distancePolicy: TrainingSportDistancePolicy;
  profileMetrics: readonly TrainingProfileMetricId[];
  showElapsedTimeInSummary?: boolean;
  showElapsedTimeInComparison?: boolean;
}

interface TrainingSportDefinitionShape {
  id: string;
  label: string;
  scopeLabel: string;
  details: string;
  iconActivityType: ActivityType;
  selectionAvailability: 'always' | 'recorded';
  capabilities: readonly TrainingSportCapability[];
  contexts: readonly TrainingSportContextDefinitionShape[];
}

/**
 * The complete app-owned Training taxonomy. Sports Lib owns canonical activity
 * types; this registry owns product grouping, presentation, and analysis policy.
 * Add a future family or context here instead of branching in builders or UI.
 */
export const TRAINING_SPORT_DEFINITIONS = [
  {
    id: 'running',
    label: 'Running',
    scopeLabel: 'Running',
    details: 'Road, trail, treadmill, indoor, virtual running, obstacle racing, and orienteering',
    iconActivityType: ActivityTypes.Running,
    selectionAvailability: 'always',
    capabilities: ['training-mix', 'best-build', 'durability', 'capacity', 'power-profile', 'power-systems'],
    contexts: [
      {
        id: 'running',
        label: 'Running',
        activityTypes: [
          ActivityTypes.Running, RefinedTypes.RoadRunning, RefinedTypes.TrackRunning,
          RefinedTypes.UltraRunning, RefinedTypes.CrosscountryRunning,
        ],
        profile: 'endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'supported',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent'],
      },
      {
        id: 'trail-running',
        label: 'Trail running',
        activityTypes: [ActivityTypes.TrailRunning, RefinedTypes.VerticalRunning],
        profile: 'vertical-endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'supported',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent'],
      },
      {
        id: 'indoor-running',
        label: 'Indoor running',
        activityTypes: [
          ActivityTypes.Treadmill, ActivityTypes.IndoorRunning, ActivityTypes.VirtualRunning,
          RefinedTypes.IndoorTrackRunning,
        ],
        profile: 'endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'supported',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time'],
      },
      {
        id: 'orienteering',
        label: 'Orienteering',
        activityTypes: [ActivityTypes.Orienteering],
        profile: 'vertical-endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent'],
      },
      {
        id: 'obstacle-racing',
        label: 'Obstacle racing',
        activityTypes: [RefinedTypes.ObstacleRacing],
        profile: 'endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent'],
      },
    ],
  },
  {
    id: 'cycling',
    label: 'Cycling',
    scopeLabel: 'Cycling/MTB',
    details: 'Road, indoor, virtual, e-bike, hand cycle, velomobile, MTB, Enduro, and Downhill',
    iconActivityType: ActivityTypes.Cycling,
    selectionAvailability: 'always',
    capabilities: ['training-mix', 'best-build', 'durability', 'capacity', 'power-profile', 'power-systems'],
    contexts: [
      {
        id: 'cycling',
        label: 'Cycling',
        activityTypes: [
          ActivityTypes.Cycling,
          RefinedTypes.RoadCycling,
          RefinedTypes.GravelCycling,
          RefinedTypes.TrackCycling,
          RefinedTypes.Cyclocross,
          ActivityTypes.EBiking,
          ActivityTypes.Handcycle,
          ActivityTypes.Velomobile,
          RefinedTypes.RecumbentCycling,
        ],
        profile: 'endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'supported',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent'],
      },
      {
        id: 'indoor-cycling',
        label: 'Indoor cycling',
        activityTypes: [
          ActivityTypes.IndoorCycling, ActivityTypes.VirtualCycling, RefinedTypes.LesMillsRPM,
          RefinedTypes.LesMillsSPRINT, RefinedTypes.LesMillsTheTrip, RefinedTypes.IndoorHandCycle,
        ],
        profile: 'endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'supported',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time'],
      },
      {
        id: 'mountain-biking',
        label: 'Mountain biking',
        activityTypes: [
          ActivityTypes.MountainBiking, RefinedTypes.EMountainBiking, RefinedTypes.MountainBikeOrienteering,
        ],
        profile: 'endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'supported',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'jump-count', 'max-jump-distance', 'grit', 'flow'],
      },
      {
        id: 'enduro',
        label: 'Enduro MTB',
        activityTypes: [ActivityTypes['Enduro MTB'], RefinedTypes.EEnduroMTB],
        profile: 'mixed-gravity',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'unsupported-context',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time', 'jump-count', 'max-jump-distance', 'grit', 'flow'],
      },
      {
        id: 'downhill',
        label: 'Downhill MTB',
        activityTypes: [ActivityTypes.DownhillCycling],
        profile: 'gravity',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'unsupported-context',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'descent', 'descent-time', 'jump-count', 'max-jump-distance', 'grit', 'flow'],
      },
      {
        id: 'bmx',
        label: 'BMX',
        activityTypes: [RefinedTypes.BMX],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent'],
      },
      {
        id: 'kickbiking',
        label: 'Kickbiking',
        activityTypes: [RefinedTypes.Kickbiking],
        profile: 'endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent'],
      },
    ],
  },
  {
    id: 'swimming',
    label: 'Swimming',
    scopeLabel: 'Swimming',
    details: 'Pool and open-water swimming',
    iconActivityType: ActivityTypes.Swimming,
    selectionAvailability: 'always',
    capabilities: ['training-mix', 'best-build', 'durability', 'swim-performance', 'power-systems'],
    contexts: [
      {
        id: 'pool-swimming',
        label: 'Pool swimming',
        activityTypes: [ActivityTypes.Swimming],
        profile: 'pool',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'supported',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'stroke-rate'],
      },
      {
        id: 'open-water-swimming',
        label: 'Open-water swimming',
        activityTypes: [ActivityTypes.OpenWaterSwimming],
        profile: 'open-water',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'supported',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'stroke-rate'],
      },
    ],
  },
  {
    id: 'rowing',
    label: 'Rowing',
    scopeLabel: 'Rowing',
    details: 'Indoor and on-water rowing, kept as separate contexts',
    iconActivityType: ActivityTypes.Rowing,
    selectionAvailability: 'always',
    capabilities: ['training-mix', 'best-build', 'power-systems'],
    contexts: [
      {
        id: 'indoor-rowing',
        label: 'Indoor rowing',
        activityTypes: [ActivityTypes.IndoorRowing, RefinedTypes.VirtualRowing],
        profile: 'rowing',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'pace-500m', 'stroke-rate', 'stroke-distance'],
      },
      {
        id: 'on-water-rowing',
        label: 'On-water rowing',
        activityTypes: [ActivityTypes.Rowing],
        profile: 'rowing',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'pace-500m', 'stroke-rate', 'stroke-distance'],
      },
    ],
  },
  {
    id: 'walking-hiking',
    label: 'Walking & Hiking',
    scopeLabel: 'Walking/Hiking',
    details: 'Walking, hiking, Nordic walking, trekking, rucking, and snowshoeing',
    iconActivityType: ActivityTypes.Hiking,
    selectionAvailability: 'always',
    capabilities: ['training-mix', 'best-build', 'power-systems'],
    contexts: [
      {
        id: 'walking',
        label: 'Walking',
        activityTypes: [
          ActivityTypes.Walking, ActivityTypes.NordicWalking, RefinedTypes.SpeedWalking,
          RefinedTypes.IndoorWalking,
        ],
        profile: 'vertical-endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent'],
      },
      {
        id: 'rucking',
        label: 'Rucking',
        activityTypes: [RefinedTypes.Rucking],
        profile: 'vertical-endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent'],
      },
      {
        id: 'snowshoeing',
        label: 'Snowshoeing',
        activityTypes: [ActivityTypes['Snowshoeing']],
        profile: 'vertical-endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'hiking',
        label: 'Hiking',
        activityTypes: [ActivityTypes.Hiking, ActivityTypes.Trekking],
        profile: 'vertical-endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent'],
      },
    ],
  },
  {
    id: 'nordic-skiing',
    label: 'Nordic Skiing',
    scopeLabel: 'Nordic Skiing',
    details: 'Cross-country skiing, roller skiing, ski orienteering, and biathlon in separate contexts',
    iconActivityType: ActivityTypes.CrosscountrySkiing,
    selectionAvailability: 'always',
    capabilities: ['training-mix', 'best-build', 'power-systems'],
    contexts: [
      {
        id: 'snow-nordic-skiing',
        label: 'Snow',
        activityTypes: [
          ActivityTypes.CrosscountrySkiing, ActivityTypes.NordicSki, RefinedTypes.ClassicCrosscountrySkiing,
          RefinedTypes.SkateSkiing,
        ],
        profile: 'vertical-endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent'],
      },
      {
        id: 'ski-orienteering',
        label: 'Ski Orienteering',
        activityTypes: [RefinedTypes.SkiOrienteering],
        profile: 'vertical-endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent'],
      },
      {
        id: 'biathlon',
        label: 'Biathlon',
        activityTypes: [RefinedTypes.Biathlon],
        profile: 'vertical-endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent'],
      },
      {
        id: 'roller-skiing',
        label: 'Roller skiing',
        activityTypes: [ActivityTypes.RollerSki, RefinedTypes.ClassicRollerSkiing, RefinedTypes.SkateRollerSkiing],
        profile: 'vertical-endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent'],
      },
    ],
  },
  {
    id: 'strength',
    label: 'Strength',
    scopeLabel: 'Strength',
    details: 'Strength training, weight training, and kettlebell sessions',
    iconActivityType: ActivityTypes.StrengthTraining,
    selectionAvailability: 'always',
    capabilities: ['training-mix', 'best-build', 'power-systems'],
    contexts: [
      {
        id: 'strength',
        label: 'Strength',
        activityTypes: [
          ActivityTypes.StrengthTraining, ActivityTypes.WeightTraining, ActivityTypes.Kettlebell,
          RefinedTypes.LesMillsBODYPUMP, RefinedTypes.Calisthenics, RefinedTypes.CoreTraining,
          RefinedTypes.LesMillsCore, RefinedTypes.LesMillsGritStrength,
        ],
        profile: 'strength',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
      },
    ],
  },
  {
    id: 'fitness-gym',
    label: 'Fitness & Gym',
    scopeLabel: 'Fitness/Gym',
    details: 'General training, conditioning, gym equipment, mobility, and fitness classes',
    iconActivityType: ActivityTypes.Training,
    selectionAvailability: 'recorded',
    capabilities: ['training-mix'],
    contexts: [
      {
        id: 'general-fitness',
        label: 'General fitness',
        activityTypes: [
          ActivityTypes.Training,
          ActivityTypes['Indoor Training'],
          ActivityTypes.Workout,
          ActivityTypes.Generic,
          ActivityTypes['Fitness Equipment'],
          RefinedTypes.IndoorSkiing,
          RefinedTypes.IndoorGrinding,
          RefinedTypes.TruckerWorkout,
        ],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
      },
      {
        id: 'conditioning',
        label: 'Conditioning',
        activityTypes: [
          ActivityTypes.HIIT,
          RefinedTypes.AMRAP,
          RefinedTypes.EMOM,
          RefinedTypes.Tabata,
          ActivityTypes['Circuit Training'],
          ActivityTypes['Cardio Training'],
          ActivityTypes.Aerobics,
          ActivityTypes.Crossfit,
          ActivityTypes.Crosstrainer,
          ActivityTypes['Elliptical Trainer'],
          ActivityTypes['Stair Stepper'],
          RefinedTypes.Bootcamp,
          RefinedTypes.FunctionalTraining,
          RefinedTypes.FitnessBoxing,
          RefinedTypes.FitnessDancing,
          RefinedTypes.FitnessMartialArts,
          RefinedTypes.JumpRope,
          RefinedTypes.StepTraining,
          RefinedTypes.LesMillsBodyAttack,
          RefinedTypes.LesMillsBodyCombat,
          RefinedTypes.LesMillsBodyJam,
          RefinedTypes.LesMillsBodyStep,
          RefinedTypes.LesMillsGritAthletic,
          RefinedTypes.LesMillsGritCardio,
          RefinedTypes.LesMillsShBam,
          RefinedTypes.LesMillsTone,
          RefinedTypes.FitnessRacing,
          RefinedTypes.AquaFitness,
        ],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
      },
      {
        id: 'water-running',
        label: 'Water Running',
        activityTypes: [RefinedTypes.WaterRunning],
        profile: 'general',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
      },
      {
        id: 'stair-climbing',
        label: 'Stair Climbing',
        activityTypes: [ActivityTypes.FloorClimbing],
        profile: 'general',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time', 'ascent'],
        showElapsedTimeInSummary: true,
      },
      {
        id: 'mobility-fitness',
        label: 'Mobility & movement',
        activityTypes: [
          ActivityTypes.Yoga,
          ActivityTypes.Pilates,
          ActivityTypes['Flexibility Training'],
          ActivityTypes.Stretching,
          ActivityTypes.Gymnastics,
          RefinedTypes.Barre,
          RefinedTypes.Mobility,
          RefinedTypes.DynamicMobility,
          RefinedTypes.StaticMobility,
          RefinedTypes.MindBodyTraining,
          RefinedTypes.PhysicalTherapy,
          RefinedTypes.LesMillsBarre,
          RefinedTypes.LesMillsBodyBalance,
        ],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
      },
    ],
  },
  {
    id: 'paddling',
    label: 'Paddling',
    scopeLabel: 'Paddling',
    details: 'Canoeing, kayaking, paddling, and stand-up paddling',
    iconActivityType: ActivityTypes.Kayaking,
    selectionAvailability: 'always',
    capabilities: ['training-mix', 'best-build', 'power-systems'],
    contexts: [
      {
        id: 'canoeing',
        label: 'Canoeing',
        activityTypes: [ActivityTypes.Canoeing],
        profile: 'paddling',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'stroke-rate', 'stroke-distance'],
      },
      {
        id: 'kayaking',
        label: 'Kayaking',
        activityTypes: [ActivityTypes.Kayaking, RefinedTypes.WhitewaterKayaking],
        profile: 'paddling',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'stroke-rate', 'stroke-distance'],
      },
      {
        id: 'paddling',
        label: 'Paddling',
        activityTypes: [ActivityTypes.Paddling],
        profile: 'paddling',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'stroke-rate', 'stroke-distance'],
      },
      {
        id: 'stand-up-paddling',
        label: 'Stand-up paddling',
        activityTypes: [ActivityTypes.StandUpPaddling],
        profile: 'paddling',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'stroke-rate', 'stroke-distance'],
      },
    ],
  },
  {
    id: 'wheelchair',
    label: 'Wheelchair Training',
    scopeLabel: 'Wheelchair Training',
    details: 'General wheelchair activity, indoor and outdoor pushing speeds, and wheelchair racing',
    iconActivityType: ActivityTypes.Wheelchair,
    selectionAvailability: 'recorded',
    capabilities: ['training-mix', 'best-build', 'power-systems'],
    contexts: [
      {
        id: 'wheelchair-general',
        label: 'Wheel Chair',
        activityTypes: [ActivityTypes.Wheelchair],
        profile: 'general',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time'],
      },
      {
        id: 'wheelchair-push-walk',
        label: 'Wheelchair Push Walk',
        activityTypes: [RefinedTypes.WheelchairPushWalk],
        profile: 'general',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time'],
      },
      {
        id: 'wheelchair-push-run',
        label: 'Wheelchair Push Run',
        activityTypes: [RefinedTypes.WheelchairPushRun],
        profile: 'general',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time'],
      },
      {
        id: 'indoor-wheelchair-push-walk',
        label: 'Indoor Wheelchair Push Walk',
        activityTypes: [RefinedTypes.IndoorWheelchairPushWalk],
        profile: 'general',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time'],
      },
      {
        id: 'indoor-wheelchair-push-run',
        label: 'Indoor Wheelchair Push Run',
        activityTypes: [RefinedTypes.IndoorWheelchairPushRun],
        profile: 'general',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time'],
      },
      {
        id: 'wheelchair-racing',
        label: 'Wheelchair Racing',
        activityTypes: [RefinedTypes.WheelchairRacing],
        profile: 'general',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time'],
      },
    ],
  },
  {
    id: 'climbing-mountaineering',
    label: 'Climbing & Mountaineering',
    scopeLabel: 'Climbing & Mountaineering',
    details: 'Climbing, bouldering, via ferrata, and mountaineering in separate contexts',
    iconActivityType: ActivityTypes['Climbing'],
    selectionAvailability: 'recorded',
    capabilities: ['training-mix', 'best-build', 'power-systems'],
    contexts: [
      {
        id: 'bouldering',
        label: 'Bouldering',
        activityTypes: [ActivityTypes['Bouldering']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time', 'ascent'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'climbing',
        label: 'Climbing',
        activityTypes: [ActivityTypes['Climbing']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time', 'ascent'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'rock-climbing',
        label: 'Rock Climbing',
        activityTypes: [ActivityTypes['Rock Climbing']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time', 'ascent'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'indoor-climbing',
        label: 'Indoor Climbing',
        activityTypes: [ActivityTypes['Indoor Climbing']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time', 'ascent'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'via-ferrata',
        label: 'Via Ferrata',
        activityTypes: [ActivityTypes['Via Ferrata']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time', 'ascent'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'mountaineering',
        label: 'Mountaineering',
        activityTypes: [ActivityTypes['Mountaineering']],
        profile: 'vertical-endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
    ],
  },
  {
    id: 'mountain-snow',
    label: 'Mountain Snow Sports',
    scopeLabel: 'Mountain Snow Sports',
    details: 'Touring, mountaineering, backcountry, splitboard, alpine, snowboard, and telemark contexts',
    iconActivityType: ActivityTypes['Alpine Skiing'],
    selectionAvailability: 'recorded',
    capabilities: ['training-mix', 'best-build', 'power-systems'],
    contexts: [
      {
        id: 'ski-touring',
        label: 'Ski Touring',
        activityTypes: [ActivityTypes['Ski Touring']],
        profile: 'mixed-gravity',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'ski-mountaineering',
        label: 'Ski Mountaineering',
        activityTypes: [RefinedTypes.SkiMountaineering],
        profile: 'mixed-gravity',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'backcountry-skiing',
        label: 'Backcountry Skiing',
        activityTypes: [ActivityTypes['Backcountry Skiing']],
        profile: 'mixed-gravity',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'backcountry-snowboarding',
        label: 'Backcountry Snowboarding',
        activityTypes: [RefinedTypes.BackcountrySnowboarding],
        profile: 'mixed-gravity',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'splitboarding',
        label: 'Splitboarding',
        activityTypes: [RefinedTypes.Splitboarding],
        profile: 'mixed-gravity',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'alpine-skiing',
        label: 'Alpine Skiing',
        activityTypes: [ActivityTypes['Alpine Skiing']],
        profile: 'gravity',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'snowboarding',
        label: 'Snowboarding',
        activityTypes: [ActivityTypes['Snowboarding']],
        profile: 'gravity',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'telemark-skiing',
        label: 'Telemark Skiing',
        activityTypes: [ActivityTypes['Telemark Skiing']],
        profile: 'gravity',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
    ],
  },
  {
    id: 'skating',
    label: 'Skating',
    scopeLabel: 'Skating',
    details: 'Inline skating, generic skating, ice skating, and skateboarding in separate contexts',
    iconActivityType: ActivityTypes['Inline Skating'],
    selectionAvailability: 'recorded',
    capabilities: ['training-mix', 'best-build', 'power-systems'],
    contexts: [
      {
        id: 'inline-skating',
        label: 'Inline Skating',
        activityTypes: [ActivityTypes['Inline Skating']],
        profile: 'endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'skating',
        label: 'Skating',
        activityTypes: [ActivityTypes['Skating']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'ice-skating',
        label: 'Ice Skating',
        activityTypes: [ActivityTypes['Ice Skating']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'skateboarding',
        label: 'Skateboarding',
        activityTypes: [RefinedTypes.Skateboarding],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'recorded',
        profileMetrics: ['distance', 'moving-time', 'elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
    ],
  },
  {
    id: 'combat-martial-arts',
    label: 'Combat & Martial Arts',
    scopeLabel: 'Combat & Martial Arts',
    details: 'Boxing, combat, judo, kickboxing, mixed martial arts, and taekwondo',
    iconActivityType: ActivityTypes['Boxing'],
    selectionAvailability: 'recorded',
    capabilities: ['training-mix', 'best-build', 'power-systems'],
    contexts: [
      {
        id: 'boxing',
        label: 'Boxing',
        activityTypes: [ActivityTypes['Boxing']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'combat',
        label: 'Combat',
        activityTypes: [ActivityTypes['Combat']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'judo',
        label: 'Judo',
        activityTypes: [RefinedTypes.Judo],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'kickboxing',
        label: 'Kickboxing',
        activityTypes: [RefinedTypes.Kickboxing],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'mixed-martial-arts',
        label: 'Mixed Martial Arts',
        activityTypes: [RefinedTypes.MixedMartialArts],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'taekwondo',
        label: 'Taekwondo',
        activityTypes: [RefinedTypes.Taekwondo],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
    ],
  },
  {
    id: 'dance',
    label: 'Dance',
    scopeLabel: 'Dance',
    details: 'Ballet, ballroom, generic, jazz, Latin, modern, show, and street dancing',
    iconActivityType: ActivityTypes['Dancing'],
    selectionAvailability: 'recorded',
    capabilities: ['training-mix', 'best-build', 'power-systems'],
    contexts: [
      {
        id: 'ballet-dancing',
        label: 'Ballet Dancing',
        activityTypes: [RefinedTypes.BalletDancing],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'ballroom-dancing',
        label: 'Ballroom Dancing',
        activityTypes: [RefinedTypes.BallroomDancing],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'dancing',
        label: 'Dancing',
        activityTypes: [ActivityTypes['Dancing']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'jazz-dancing',
        label: 'Jazz Dancing',
        activityTypes: [RefinedTypes.JazzDancing],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'latin-dancing',
        label: 'Latin Dancing',
        activityTypes: [RefinedTypes.LatinDancing],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'modern-dancing',
        label: 'Modern Dancing',
        activityTypes: [RefinedTypes.ModernDancing],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'show-dancing',
        label: 'Show Dancing',
        activityTypes: [RefinedTypes.ShowDancing],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'street-dancing',
        label: 'Street Dancing',
        activityTypes: [RefinedTypes.StreetDancing],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
    ],
  },
  {
    id: 'team-sports',
    label: 'Team Sports',
    scopeLabel: 'Team Sports',
    details: 'Basketball, wheelchair basketball, football, soccer, and indoor or beach volleyball',
    iconActivityType: ActivityTypes['Basketball'],
    selectionAvailability: 'recorded',
    capabilities: ['training-mix', 'best-build', 'power-systems'],
    contexts: [
      {
        id: 'basketball',
        label: 'Basketball',
        activityTypes: [ActivityTypes['Basketball']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'wheelchair-basketball',
        label: 'Wheelchair Basketball',
        activityTypes: [RefinedTypes.WheelchairBasketball],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'football',
        label: 'Football',
        activityTypes: [ActivityTypes['Football']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'soccer',
        label: 'Soccer',
        activityTypes: [ActivityTypes['Soccer']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'volleyball',
        label: 'Volleyball',
        activityTypes: [ActivityTypes['Volleyball']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'beach-volleyball',
        label: 'Beach Volleyball',
        activityTypes: [RefinedTypes.BeachVolleyball],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
    ],
  },
  {
    id: 'racket-sports',
    label: 'Racket Sports',
    scopeLabel: 'Racket Sports',
    details: 'Badminton, tennis variants, padel, pickleball, racquet ball, squash, and generic racket sport',
    iconActivityType: ActivityTypes['Tennis'],
    selectionAvailability: 'recorded',
    capabilities: ['training-mix', 'best-build', 'power-systems'],
    contexts: [
      {
        id: 'badminton',
        label: 'Badminton',
        activityTypes: [ActivityTypes['Badminton']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'beach-tennis',
        label: 'Beach Tennis',
        activityTypes: [RefinedTypes.BeachTennis],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'padel',
        label: 'Padel',
        activityTypes: [RefinedTypes.Padel],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'pickleball',
        label: 'Pickleball',
        activityTypes: [RefinedTypes.Pickleball],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'platform-tennis',
        label: 'Platform Tennis',
        activityTypes: [RefinedTypes.PlatformTennis],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'racket-sport',
        label: 'Racket Sport',
        activityTypes: [RefinedTypes.RacketSport],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'racquet-ball',
        label: 'Racquet Ball',
        activityTypes: [ActivityTypes['Racquet Ball']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'squash',
        label: 'Squash',
        activityTypes: [ActivityTypes['Squash']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'table-tennis',
        label: 'Table Tennis',
        activityTypes: [ActivityTypes['Table Tennis']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'tennis',
        label: 'Tennis',
        activityTypes: [ActivityTypes['Tennis']],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
      {
        id: 'wheelchair-tennis',
        label: 'Wheelchair Tennis',
        activityTypes: [RefinedTypes.WheelchairTennis],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
        showElapsedTimeInSummary: true,
        showElapsedTimeInComparison: true,
      },
    ],
  },
  {
    id: 'other-training',
    label: 'Other training',
    scopeLabel: 'Other training',
    details: 'Recorded sports that do not belong to a modeled Training family',
    iconActivityType: ActivityTypes.Other,
    selectionAvailability: 'recorded',
    capabilities: ['training-mix'],
    contexts: [
      {
        id: 'other-training',
        label: 'Other training',
        activityTypes: [ActivityTypes.Other],
        profile: 'general',
        intensityPolicy: 'volume-only',
        loadPolicy: 'recorded',
        durabilityPolicy: 'omit',
        distancePolicy: 'omit',
        profileMetrics: ['elapsed-time'],
      },
    ],
  },
] as const satisfies readonly TrainingSportDefinitionShape[];

export type TrainingSportDefinition = typeof TRAINING_SPORT_DEFINITIONS[number];
export type TrainingSportId = TrainingSportDefinition['id'];
export type TrainingDiscipline = TrainingSportId;
export type TrainingDestinationId = 'overview' | TrainingSportId | 'other-power';
export type TrainingSportContextDefinition = TrainingSportDefinition['contexts'][number]
  & Pick<TrainingSportContextDefinitionShape, 'showElapsedTimeInSummary' | 'showElapsedTimeInComparison'>;
export type TrainingSportContextId = TrainingSportContextDefinition['id'];

export const TRAINING_DISCIPLINES = TRAINING_SPORT_DEFINITIONS.map(
  sport => sport.id,
) as [TrainingSportId, ...TrainingSportId[]];

export const TRAINING_SPORT_CONTEXT_IDS = TRAINING_SPORT_DEFINITIONS.flatMap(
  sport => sport.contexts.map(context => context.id),
) as [TrainingSportContextId, ...TrainingSportContextId[]];

/** The frozen public MCP subset; internal Training snapshots contain all registered sports. */
export const PUBLIC_TRAINING_DISCIPLINES = ['running', 'cycling', 'swimming'] as const;
export type PublicTrainingDiscipline = typeof PUBLIC_TRAINING_DISCIPLINES[number];

export type TrainingSportIdWithCapability<
  Capability extends TrainingSportCapability,
  Definition extends TrainingSportDefinition = TrainingSportDefinition,
> = Definition extends TrainingSportDefinition
  ? Capability extends Definition['capabilities'][number]
    ? Definition['id']
    : never
  : never;

export type PowerCapacityDiscipline = TrainingSportIdWithCapability<'capacity'>;
export const POWER_CAPACITY_DISCIPLINES = TRAINING_SPORT_DEFINITIONS
  .filter(sport => (sport.capabilities as readonly TrainingSportCapability[]).includes('capacity'))
  .map(sport => sport.id) as PowerCapacityDiscipline[];

export interface ResolvedTrainingSportContext {
  sport: TrainingSportId;
  context: TrainingSportContextId;
  profile: TrainingAnalysisProfile;
  intensityPolicy: TrainingSportIntensityPolicy;
  loadPolicy: TrainingSportLoadPolicy;
  durabilityPolicy: TrainingSportDurabilityPolicy;
  distancePolicy: TrainingSportDistancePolicy;
  profileMetrics: readonly TrainingProfileMetricId[];
}

function assertUniqueTrainingRegistryValues(
  values: readonly string[],
  description: string,
): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Training registry contains a duplicate ${description}.`);
  }
}

assertUniqueTrainingRegistryValues(
  TRAINING_SPORT_DEFINITIONS.map(sport => sport.id),
  'sport ID',
);
assertUniqueTrainingRegistryValues(TRAINING_SPORT_CONTEXT_IDS, 'context ID');
assertUniqueTrainingRegistryValues(
  TRAINING_PROFILE_METRIC_DEFINITIONS.map(metric => metric.id),
  'profile metric ID',
);
TRAINING_SPORT_DEFINITIONS.forEach((sport) => {
  assertUniqueTrainingRegistryValues(sport.capabilities, `capability in ${sport.id}`);
  sport.contexts.forEach((context) => {
    assertUniqueTrainingRegistryValues(context.profileMetrics, `profile metric in ${context.id}`);
  });
});

const sportDefinitionById = new Map<TrainingSportId, TrainingSportDefinition>(
  TRAINING_SPORT_DEFINITIONS.map(sport => [sport.id, sport]),
);
const contextDefinitionById = new Map<TrainingSportContextId, TrainingSportContextDefinition>(
  TRAINING_SPORT_DEFINITIONS.flatMap(sport => sport.contexts.map(context => [context.id, context] as const)),
);
const profileMetricDefinitionById = new Map<TrainingProfileMetricId, TrainingProfileMetricDefinition>(
  TRAINING_PROFILE_METRIC_DEFINITIONS.map(metric => [metric.id, metric]),
);
const contextByActivityType = new Map<ActivityType, ResolvedTrainingSportContext>();
const knownActivityTypes = new Set<ActivityType>(
  Object.values(ActivityTypes).filter((value): value is ActivityType => typeof value === 'string'),
);
const aggregateActivityTypes = new Set<ActivityType>([
  ActivityTypes.Aquathlon,
  ActivityTypes.Duathlon,
  ActivityTypes.Multisport,
  ActivityTypes.Swimrun,
  ActivityTypes.Triathlon,
  ActivityTypes.Transition,
  ActivityTypes.Route,
  RefinedTypes.BrickTraining,
  RefinedTypes.PoolTriathlon,
  RefinedTypes.OffroadTriathlon,
  RefinedTypes.OffroadDuathlon,
]);

TRAINING_SPORT_DEFINITIONS.forEach((sport) => {
  sport.contexts.forEach((context) => {
    context.activityTypes.forEach((activityType) => {
      if (contextByActivityType.has(activityType)) {
        throw new Error(`Training activity type is assigned more than once: ${activityType}`);
      }
      contextByActivityType.set(activityType, {
        sport: sport.id,
        context: context.id,
        profile: context.profile,
        intensityPolicy: context.intensityPolicy,
        loadPolicy: context.loadPolicy,
        durabilityPolicy: context.durabilityPolicy,
        distancePolicy: context.distancePolicy,
        profileMetrics: context.profileMetrics,
      });
    });
  });
});

const otherTrainingFallbackContext = contextByActivityType.get(ActivityTypes.Other);
if (!otherTrainingFallbackContext) {
  throw new Error('Training registry is missing the Other training fallback context.');
}

export function getTrainingSportDefinition(value: TrainingSportId): TrainingSportDefinition | null {
  return sportDefinitionById.get(value) || null;
}

export function getTrainingSportContextDefinition(
  value: TrainingSportContextId,
): TrainingSportContextDefinition | null {
  return contextDefinitionById.get(value) || null;
}

export function getTrainingProfileMetricDefinition(
  value: TrainingProfileMetricId,
): TrainingProfileMetricDefinition | null {
  return profileMetricDefinitionById.get(value) || null;
}

export function hasTrainingSportCapability(
  sport: TrainingSportId,
  capability: TrainingSportCapability,
): boolean {
  const capabilities = getTrainingSportDefinition(sport)?.capabilities as readonly TrainingSportCapability[] | undefined;
  return capabilities?.includes(capability) === true;
}

export function createTrainingSportRecord<T>(
  factory: (sport: TrainingSportDefinition) => T,
): Record<TrainingSportId, T> {
  return Object.fromEntries(
    TRAINING_SPORT_DEFINITIONS.map(sport => [sport.id, factory(sport)]),
  ) as Record<TrainingSportId, T>;
}

/**
 * Resolves stored provider aliases through Sports Lib before applying the
 * exact, disjoint Training context registry. Known non-aggregate types that do
 * not have a modeled family resolve to Other Training with saved TSS and
 * duration summaries; their intensity and specialist exclusions remain separate.
 * Aggregate types such as Triathlon remain excluded; normalized child
 * activities are resolved independently.
 */
export function resolveTrainingSportContextFromActivityType(
  value: unknown,
): ResolvedTrainingSportContext | null {
  if (typeof value !== 'string') {
    return null;
  }
  const canonicalType = resolveCompatibleActivityType(value);
  if (typeof canonicalType !== 'string') {
    return null;
  }
  const exactContext = contextByActivityType.get(canonicalType);
  if (exactContext) {
    return exactContext;
  }
  return !knownActivityTypes.has(canonicalType) || aggregateActivityTypes.has(canonicalType)
    ? null
    : otherTrainingFallbackContext || null;
}

/** Only the provider's generic/road refinements share rolling capacity history. */
export function resolveTrainingPowerSystemsModelActivityType(value: unknown): ActivityType | null {
  const activityType = resolveCompatibleActivityType(value);
  if (activityType === ActivityTypes.Cycling || activityType === RefinedTypes.RoadCycling) {
    return ActivityTypes.Cycling;
  }
  if (activityType === ActivityTypes.Running || activityType === RefinedTypes.RoadRunning) {
    return ActivityTypes.Running;
  }
  return activityType;
}

export function resolveTrainingDisciplineFromActivityType(value: unknown): TrainingDiscipline | null {
  return resolveTrainingSportContextFromActivityType(value)?.sport || null;
}

export function isTrainingDiscipline(value: unknown): value is TrainingDiscipline {
  return typeof value === 'string'
    && TRAINING_DISCIPLINES.includes(value as TrainingDiscipline);
}

export function isTrainingDestinationId(value: unknown): value is TrainingDestinationId {
  return value === 'overview' || value === 'other-power' || isTrainingDiscipline(value);
}

export function normalizeTrainingDestinationId(value: unknown): TrainingDestinationId {
  return isTrainingDestinationId(value) ? value : 'overview';
}

export function isTrainingSportContextId(value: unknown): value is TrainingSportContextId {
  return typeof value === 'string'
    && TRAINING_SPORT_CONTEXT_IDS.includes(value as TrainingSportContextId);
}

export function isTrainingProfileMetricId(value: unknown): value is TrainingProfileMetricId {
  return typeof value === 'string'
    && TRAINING_PROFILE_METRIC_DEFINITIONS.some(metric => metric.id === value);
}

export function isPowerCapacityDiscipline(value: unknown): value is PowerCapacityDiscipline {
  return typeof value === 'string'
    && POWER_CAPACITY_DISCIPLINES.includes(value as PowerCapacityDiscipline);
}
