import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';

export interface WahooWorkoutType {
  id: number;
  name: string;
}

const MULTISPORT_WORKOUT_TYPE: WahooWorkoutType = { id: 62, name: 'MULTISPORT' };

const WAHOO_WORKOUT_TYPES_BY_ACTIVITY_TYPE = new Map<ActivityTypes, WahooWorkoutType>([
  [ActivityTypes.Cycling, { id: 0, name: 'BIKING' }],
  [ActivityTypes.Running, { id: 1, name: 'RUNNING' }],
  [ActivityTypes['Trail Running'], { id: 4, name: 'RUNNING_TRAIL' }],
  [ActivityTypes['Indoor Running'], { id: 5, name: 'RUNNING_TREADMILL' }],
  [ActivityTypes.Treadmill, { id: 5, name: 'RUNNING_TREADMILL' }],
  [ActivityTypes.Walking, { id: 6, name: 'WALKING' }],
  [ActivityTypes['Nordic Walking'], { id: 8, name: 'WALKING_NORDIC' }],
  [ActivityTypes.Hiking, { id: 9, name: 'HIKING' }],
  [ActivityTypes.Trekking, { id: 9, name: 'HIKING' }],
  [ActivityTypes.Mountaineering, { id: 10, name: 'MOUNTAINEERING' }],
  [ActivityTypes['Indoor Cycling'], { id: 12, name: 'BIKING_INDOOR' }],
  [ActivityTypes['Mountain Biking'], { id: 13, name: 'BIKING_MOUNTAIN' }],
  [ActivityTypes['Enduro MTB'], { id: 13, name: 'BIKING_MOUNTAIN' }],
  [ActivityTypes['Downhill Cycling'], { id: 13, name: 'BIKING_MOUNTAIN' }],
  [ActivityTypes.Motorcycling, { id: 17, name: 'BIKING_MOTOCYCLING' }],
  [ActivityTypes['Fitness Equipment'], { id: 18, name: 'FE_GENERAL' }],
  [ActivityTypes['Elliptical Trainer'], { id: 20, name: 'FE_ELLIPTICAL' }],
  [ActivityTypes.Crosstrainer, { id: 20, name: 'FE_ELLIPTICAL' }],
  [ActivityTypes['Indoor Rowing'], { id: 22, name: 'FE_ROWER' }],
  [ActivityTypes.Swimming, { id: 25, name: 'SWIMMING_LAP' }],
  [ActivityTypes['Open Water Swimming'], { id: 26, name: 'SWIMMING_OPEN_WATER' }],
  [ActivityTypes.Snowboarding, { id: 27, name: 'SNOWBOARDING' }],
  [ActivityTypes['Backcountry Skiing'], { id: 28, name: 'SKIING' }],
  [ActivityTypes['Ski Touring'], { id: 28, name: 'SKIING' }],
  [ActivityTypes['Alpine Skiing'], { id: 29, name: 'SKIING_DOWNHILL' }],
  [ActivityTypes['Telemark Skiing'], { id: 29, name: 'SKIING_DOWNHILL' }],
  [ActivityTypes['Crosscountry Skiing'], { id: 30, name: 'SKIINGCROSS_COUNTRY' }],
  [ActivityTypes['Nordic Skiing'], { id: 30, name: 'SKIINGCROSS_COUNTRY' }],
  [ActivityTypes.Skating, { id: 31, name: 'SKATING' }],
  [ActivityTypes['Ice Skating'], { id: 32, name: 'SKATING_ICE' }],
  [ActivityTypes['Inline Skating'], { id: 33, name: 'SKATING_INLINE' }],
  [ActivityTypes.Sailing, { id: 35, name: 'SAILING' }],
  [ActivityTypes.Windsurfing, { id: 36, name: 'WINDSURFING' }],
  [ActivityTypes.Canoeing, { id: 37, name: 'CANOEING' }],
  [ActivityTypes.Kayaking, { id: 38, name: 'KAYAKING' }],
  [ActivityTypes.Rowing, { id: 39, name: 'ROWING' }],
  [ActivityTypes.Kitesurfing, { id: 40, name: 'KITEBOARDING' }],
  [ActivityTypes['Stand Up Paddling'], { id: 41, name: 'STAND_UP_PADDLE_BOARD' }],
  [ActivityTypes.Generic, { id: 42, name: 'WORKOUT' }],
  [ActivityTypes.Training, { id: 42, name: 'WORKOUT' }],
  [ActivityTypes.Workout, { id: 42, name: 'WORKOUT' }],
  [ActivityTypes['Indoor Training'], { id: 42, name: 'WORKOUT' }],
  [ActivityTypes.Aerobics, { id: 43, name: 'CARDIO_CLASS' }],
  [ActivityTypes['Cardio Training'], { id: 43, name: 'CARDIO_CLASS' }],
  [ActivityTypes['Circuit Training'], { id: 43, name: 'CARDIO_CLASS' }],
  [ActivityTypes.HIIT, { id: 43, name: 'CARDIO_CLASS' }],
  [ActivityTypes.Crossfit, { id: 43, name: 'CARDIO_CLASS' }],
  [ActivityTypes['Stair Stepper'], { id: 44, name: 'STAIR_CLIMBER' }],
  [ActivityTypes['Floor Climbing'], { id: 44, name: 'STAIR_CLIMBER' }],
  [ActivityTypes['Wheel Chair'], { id: 45, name: 'WHEELCHAIR' }],
  [ActivityTypes.Golf, { id: 46, name: 'GOLFING' }],
  [ActivityTypes.Other, { id: 47, name: 'OTHER' }],
  [ActivityTypes.Multisport, MULTISPORT_WORKOUT_TYPE],
  [ActivityTypes.Triathlon, MULTISPORT_WORKOUT_TYPE],
  [ActivityTypes.Duathlon, MULTISPORT_WORKOUT_TYPE],
  [ActivityTypes.Aquathlon, MULTISPORT_WORKOUT_TYPE],
  [ActivityTypes.Swimrun, MULTISPORT_WORKOUT_TYPE],
  [ActivityTypes['Adventure Racing'], MULTISPORT_WORKOUT_TYPE],
  [ActivityTypes.Transition, { id: 63, name: 'TRANSITION' }],
  [ActivityTypes['E-Biking'], { id: 64, name: 'EBIKING' }],
  [ActivityTypes.Yoga, { id: 66, name: 'YOGA' }],
  [ActivityTypes['Virtual Cycling'], { id: 68, name: 'BIKING_INDOOR_VIRTUAL' }],
  [ActivityTypes['Hand Cycle'], { id: 70, name: 'HANDCYCLING' }],
  [ActivityTypes['Virtual Running'], { id: 71, name: 'RUNNING_INDOOR_VIRTUAL' }],
]);

const WAHOO_WORKOUT_TYPES_BY_ID = new Map<number, WahooWorkoutType>();
for (const workoutType of WAHOO_WORKOUT_TYPES_BY_ACTIVITY_TYPE.values()) {
  WAHOO_WORKOUT_TYPES_BY_ID.set(workoutType.id, workoutType);
}

export function resolveCanonicalActivityTypes(value: unknown): ActivityTypes[] {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(new Set(values
    .map(activityType => ActivityTypesHelper.resolveActivityType(activityType))
    .filter((activityType): activityType is ActivityTypes => activityType !== null)));
}

export function resolveWahooWorkoutType(value: unknown): WahooWorkoutType | null {
  const activityTypes = resolveCanonicalActivityTypes(value);
  if (activityTypes.length > 1) {
    return MULTISPORT_WORKOUT_TYPE;
  }
  if (activityTypes.length === 0) {
    return null;
  }
  return WAHOO_WORKOUT_TYPES_BY_ACTIVITY_TYPE.get(activityTypes[0]) || null;
}

export function getWahooWorkoutTypeById(value: unknown): WahooWorkoutType | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }
  return WAHOO_WORKOUT_TYPES_BY_ID.get(value) || null;
}

export function getMappedWahooActivityTypes(): ReadonlySet<ActivityTypes> {
  return new Set(WAHOO_WORKOUT_TYPES_BY_ACTIVITY_TYPE.keys());
}
