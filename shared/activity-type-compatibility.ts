import { ActivityTypesHelper, type ActivityTypes } from '@sports-alliance/sports-lib';

// Exact canonical names approved for the forthcoming Sports Lib catalog. Keep
// this bridge narrow while QS still builds against the current published enum.
export const RefinedTrainingActivityTypes = {
  RoadRunning: 'Road Running',
  IndoorTrackRunning: 'Indoor Track Running',
  VerticalRunning: 'Vertical Running',
  RoadCycling: 'Road Cycling',
  GravelCycling: 'Gravel Cycling',
  TrackCycling: 'Track Cycling',
  Cyclocross: 'Cyclocross',
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

// The enum assertion is confined to this compatibility boundary, not persisted
// payloads or provider decoding. These are canonical strings in the new catalog.
export const CompatibleTrainingActivityTypes = RefinedTrainingActivityTypes as unknown as {
  readonly [K in keyof typeof RefinedTrainingActivityTypes]:
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
