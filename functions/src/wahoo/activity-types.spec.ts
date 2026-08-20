import { describe, expect, it } from 'vitest';
import { ActivityTypesHelper } from '@sports-alliance/sports-lib';

import {
  getMappedWahooActivityTypes,
  getWahooWorkoutTypeById,
  resolveWahooWorkoutType,
} from '../../../shared/wahoo-activity-types';

const EXPECTED_MAPPINGS: Array<[string[], number, string]> = [
  [['Cycling'], 0, 'BIKING'],
  [['Running'], 1, 'RUNNING'],
  [['Trail Running'], 4, 'RUNNING_TRAIL'],
  [['Indoor Running', 'Treadmill'], 5, 'RUNNING_TREADMILL'],
  [['Walking'], 6, 'WALKING'],
  [['Nordic Walking'], 8, 'WALKING_NORDIC'],
  [['Hiking', 'Trekking'], 9, 'HIKING'],
  [['Mountaineering'], 10, 'MOUNTAINEERING'],
  [['Indoor Cycling'], 12, 'BIKING_INDOOR'],
  [['Mountain Biking', 'Enduro MTB', 'Downhill Cycling'], 13, 'BIKING_MOUNTAIN'],
  [['Motorcycling'], 17, 'BIKING_MOTOCYCLING'],
  [['Fitness Equipment'], 18, 'FE_GENERAL'],
  [['Elliptical Trainer', 'Crosstrainer'], 20, 'FE_ELLIPTICAL'],
  [['Indoor Rowing'], 22, 'FE_ROWER'],
  [['Swimming'], 25, 'SWIMMING_LAP'],
  [['Open Water Swimming'], 26, 'SWIMMING_OPEN_WATER'],
  [['Snowboarding'], 27, 'SNOWBOARDING'],
  [['Backcountry Skiing', 'Ski Touring'], 28, 'SKIING'],
  [['Alpine Skiing', 'Telemark Skiing'], 29, 'SKIING_DOWNHILL'],
  [['Crosscountry Skiing', 'Nordic Skiing'], 30, 'SKIINGCROSS_COUNTRY'],
  [['Skating'], 31, 'SKATING'],
  [['Ice Skating'], 32, 'SKATING_ICE'],
  [['Inline Skating'], 33, 'SKATING_INLINE'],
  [['Sailing'], 35, 'SAILING'],
  [['Windsurfing'], 36, 'WINDSURFING'],
  [['Canoeing'], 37, 'CANOEING'],
  [['Kayaking'], 38, 'KAYAKING'],
  [['Rowing'], 39, 'ROWING'],
  [['Kitesurfing'], 40, 'KITEBOARDING'],
  [['Stand Up Paddling'], 41, 'STAND_UP_PADDLE_BOARD'],
  [['Generic', 'Training', 'Workout', 'Indoor Training'], 42, 'WORKOUT'],
  [['Aerobics', 'Cardio Training', 'Circuit Training', 'HIIT', 'Crossfit'], 43, 'CARDIO_CLASS'],
  [['Stair Stepper', 'Floor Climbing'], 44, 'STAIR_CLIMBER'],
  [['Wheel Chair'], 45, 'WHEELCHAIR'],
  [['Golf'], 46, 'GOLFING'],
  [['Other'], 47, 'OTHER'],
  [['Multisport', 'Triathlon', 'Duathlon', 'Aquathlon', 'Swimrun', 'Adventure Racing'], 62, 'MULTISPORT'],
  [['Transition'], 63, 'TRANSITION'],
  [['E-Biking'], 64, 'EBIKING'],
  [['Yoga'], 66, 'YOGA'],
  [['Virtual Cycling'], 68, 'BIKING_INDOOR_VIRTUAL'],
  [['Hand Cycle'], 70, 'HANDCYCLING'],
  [['Virtual Running'], 71, 'RUNNING_INDOOR_VIRTUAL'],
];

const EXPECTED_UNMAPPED_ACTIVITY_TYPES = [
  'American Football',
  'Badminton',
  'Baseball',
  'Basketball',
  'Boating',
  'Bouldering',
  'Bowling',
  'Boxing',
  'Canyoning',
  'Cheerleading',
  'Climbing',
  'Combat',
  'Cricket',
  'Dancing',
  'Diving',
  'Driving',
  'Fishing',
  'Flexibility Training',
  'Floorball',
  'Flying',
  'Football',
  'Free Diving',
  'Frisbee',
  'Gymnastics',
  'Handball',
  'Hang Gliding',
  'Horseback Riding',
  'Hunting',
  'Ice Hockey',
  'Indoor Climbing',
  'Jumpmaster',
  'Kettlebell',
  'Match',
  'Mermaiding',
  'Motorsports',
  'Orienteering',
  'Paddling',
  'Paragliding',
  'Pilates',
  'Racquet Ball',
  'Rafting',
  'Rock Climbing',
  'Roller Skiing',
  'Route',
  'Rugby',
  'Scuba Diving',
  'Sky Diving',
  'Snorkeling',
  'Snowmobiling',
  'Snowshoeing',
  'Soccer',
  'Softball',
  'Squash',
  'Strength Training',
  'Stretching',
  'Surfing',
  'Table Tennis',
  'Tactical',
  'Tennis',
  'Track and Field',
  'Unknown Sport',
  'Velomobile',
  'Via Ferrata',
  'Volleyball',
  'Wakeboarding',
  'Water Skiing',
  'Weight Training',
];

describe('Wahoo activity type mapping', () => {
  it.each(EXPECTED_MAPPINGS)('maps %j to Wahoo %s (%s)', (activityTypes, id, name) => {
    for (const activityType of activityTypes) {
      expect(resolveWahooWorkoutType(activityType)).toEqual({ id, name });
    }
  });

  it('maps multiple canonical activity types to multisport', () => {
    expect(resolveWahooWorkoutType(['Running', 'Cycling'])).toEqual({
      id: 62,
      name: 'MULTISPORT',
    });
  });

  it('keeps an explicit inventory of every current unmapped Sports Lib type', () => {
    const mappedActivityTypes = getMappedWahooActivityTypes();
    const unmappedActivityTypes = ActivityTypesHelper.getActivityTypesAsUniqueArray()
      .filter(activityType => !mappedActivityTypes.has(activityType as never));

    expect(unmappedActivityTypes).toEqual(EXPECTED_UNMAPPED_ACTIVITY_TYPES);
    for (const activityType of unmappedActivityTypes) {
      expect(resolveWahooWorkoutType(activityType)).toBeNull();
    }
  });

  it('validates only numeric IDs from the explicit mapping', () => {
    expect(getWahooWorkoutTypeById(0)).toEqual({ id: 0, name: 'BIKING' });
    expect(getWahooWorkoutTypeById(9)).toEqual({ id: 9, name: 'HIKING' });
    expect(getWahooWorkoutTypeById('9')).toBeNull();
    expect(getWahooWorkoutTypeById(999)).toBeNull();
  });
});
