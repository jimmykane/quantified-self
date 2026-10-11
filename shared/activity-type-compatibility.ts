import { ActivityTypesHelper, type ActivityTypes } from '@sports-alliance/sports-lib';

// Exact canonical names approved for the forthcoming Sports Lib catalog. Keep
// this bridge narrow while QS still builds against the current published enum.
// This original list also defines the previously approved public recipe names.
export const RefinedTrainingActivityTypes = {
  RoadRunning: 'Road Running',
  IndoorTrackRunning: 'Indoor Track Running',
  VerticalRunning: 'Vertical Running',
  TrackRunning: 'Track Running',
  UltraRunning: 'Ultra Running',
  CrosscountryRunning: 'Crosscountry Running',
  ObstacleRacing: 'Obstacle Racing',
  RoadCycling: 'Road Cycling',
  GravelCycling: 'Gravel Cycling',
  TrackCycling: 'Track Cycling',
  Cyclocross: 'Cyclocross',
  RecumbentCycling: 'Recumbent Cycling',
  IndoorHandCycle: 'Indoor Hand Cycle',
  EMountainBiking: 'E-Mountain Biking',
  MountainBikeOrienteering: 'Mountain Bike Orienteering',
  EEnduroMTB: 'E-Enduro MTB',
  BMX: 'BMX',
  Kickbiking: 'Kickbiking',
  LesMillsRPM: 'LES MILLS RPM',
  LesMillsSPRINT: 'LES MILLS SPRINT',
  LesMillsTheTrip: 'LES MILLS THE TRIP',
  IndoorWalking: 'Indoor Walking',
  SpeedWalking: 'Speed Walking',
  ClassicCrosscountrySkiing: 'Classic Crosscountry Skiing',
  SkateSkiing: 'Skate Skiing',
  AMRAP: 'AMRAP',
  EMOM: 'EMOM',
  Tabata: 'Tabata',
  LesMillsBODYPUMP: 'LES MILLS BODYPUMP',
} as const;

// Recorded-analysis approvals do not add unpublished names to public recipes.
export const RefinedRecordedActivityTypes = {
  ClassicRollerSkiing: 'Classic Roller Skiing',
  SkateRollerSkiing: 'Skate Roller Skiing',
  VirtualRowing: 'Virtual Rowing',
  WhitewaterKayaking: 'Whitewater Kayaking',
  BrickTraining: 'Brick Training',
  PoolTriathlon: 'Pool Triathlon',
  OffroadTriathlon: 'Offroad Triathlon',
  OffroadDuathlon: 'Offroad Duathlon',
} as const;

const refinedActivityTypes = { ...RefinedTrainingActivityTypes, ...RefinedRecordedActivityTypes } as const;

// The enum assertion is confined to this compatibility boundary, not persisted
// payloads or provider decoding. These are canonical strings in the new catalog.
export const CompatibleTrainingActivityTypes = refinedActivityTypes as unknown as {
  readonly [K in keyof typeof refinedActivityTypes]:
    ActivityTypes;
};

export const WALKING_ACTIVITY_TYPE_GROUP = 'walking_group' as const;

const refinedNames = new Map<string, ActivityTypes>(Object.values(CompatibleTrainingActivityTypes)
  .map(name => [name.toLowerCase(), name]));

export function resolveCompatibleActivityType(value: unknown): ActivityTypes | null {
  if (typeof value !== 'string') {
    return null;
  }
  return ActivityTypesHelper.resolveActivityType(value)
    || refinedNames.get(value.trim().toLowerCase())
    || null;
}
