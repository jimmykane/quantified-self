import { ActivityTypes } from '@sports-alliance/sports-lib';
import { MANUAL_WORKOUT_EDITOR_SPORTS_V1 } from '@shared/planned-workout';
import {
  createTrainingSportRecord,
  getTrainingSportDefinition,
  normalizeTrainingDestinationId,
  resolveTrainingDisciplineFromActivityType,
  resolveTrainingSportContextFromActivityType,
  resolveTrainingPowerSystemsModelActivityType,
  TRAINING_DISCIPLINES,
  TRAINING_PROFILE_METRIC_DEFINITIONS,
  TRAINING_SPORT_DEFINITIONS,
} from '@shared/training-disciplines';

describe('shared Training sport registry', () => {
  it('defines modeled and fallback sport families in presentation order', () => {
    expect(TRAINING_DISCIPLINES).toEqual([
      'running',
      'cycling',
      'swimming',
      'rowing',
      'walking-hiking',
      'nordic-skiing',
      'strength',
      'fitness-gym',
      'paddling',
      'other-training',
    ]);
    expect(TRAINING_SPORT_DEFINITIONS.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'running', label: 'Running' },
      { id: 'cycling', label: 'Cycling' },
      { id: 'swimming', label: 'Swimming' },
      { id: 'rowing', label: 'Rowing' },
      { id: 'walking-hiking', label: 'Walking & Hiking' },
      { id: 'nordic-skiing', label: 'Nordic Skiing' },
      { id: 'strength', label: 'Strength' },
      { id: 'fitness-gym', label: 'Fitness & Gym' },
      { id: 'paddling', label: 'Paddling' },
      { id: 'other-training', label: 'Other training' },
    ]);
  });

  it.each([
    ['Road Running', 'running', 'running'],
    ['Track Running', 'running', 'running'],
    ['Ultra Running', 'running', 'running'],
    ['Crosscountry Running', 'running', 'running'],
    ['Obstacle Racing', 'running', 'obstacle-racing'],
    ['Indoor Track Running', 'running', 'indoor-running'],
    ['Vertical Running', 'running', 'trail-running'],
    ['Road Cycling', 'cycling', 'cycling'],
    ['Recumbent Cycling', 'cycling', 'cycling'],
    ['Indoor Hand Cycle', 'cycling', 'indoor-cycling'],
    ['E-Mountain Biking', 'cycling', 'mountain-biking'],
    ['Mountain Bike Orienteering', 'cycling', 'mountain-biking'],
    ['E-Enduro MTB', 'cycling', 'enduro'],
    ['BMX', 'cycling', 'bmx'],
    ['Kickbiking', 'cycling', 'kickbiking'],
    ['Gravel Cycling', 'cycling', 'cycling'],
    ['Track Cycling', 'cycling', 'cycling'],
    ['Cyclocross', 'cycling', 'cycling'],
    ['LES MILLS RPM', 'cycling', 'indoor-cycling'],
    ['LES MILLS SPRINT', 'cycling', 'indoor-cycling'],
    ['LES MILLS THE TRIP', 'cycling', 'indoor-cycling'],
    ['Indoor Walking', 'walking-hiking', 'walking'],
    ['Speed Walking', 'walking-hiking', 'walking'],
    ['Classic Crosscountry Skiing', 'nordic-skiing', 'snow-nordic-skiing'],
    ['Skate Skiing', 'nordic-skiing', 'snow-nordic-skiing'],
    ['AMRAP', 'fitness-gym', 'conditioning'],
    ['EMOM', 'fitness-gym', 'conditioning'],
    ['Tabata', 'fitness-gym', 'conditioning'],
    ['LES MILLS BODYPUMP', 'strength', 'strength'],
    ['Classic Roller Skiing', 'nordic-skiing', 'roller-skiing'],
    ['Skate Roller Skiing', 'nordic-skiing', 'roller-skiing'],
    ['Virtual Rowing', 'rowing', 'indoor-rowing'],
    ['Whitewater Kayaking', 'paddling', 'kayaking'],
    ['Calisthenics', 'strength', 'strength'],
    ['Core Training', 'strength', 'strength'],
    ['LES MILLS CORE', 'strength', 'strength'],
    ['LES MILLS GRIT Strength', 'strength', 'strength'],
    ['Bootcamp', 'fitness-gym', 'conditioning'],
    ['Functional Training', 'fitness-gym', 'conditioning'],
    ['Fitness Boxing', 'fitness-gym', 'conditioning'],
    ['Fitness Dancing', 'fitness-gym', 'conditioning'],
    ['Fitness Martial Arts', 'fitness-gym', 'conditioning'],
    ['Jump Rope', 'fitness-gym', 'conditioning'],
    ['Step Training', 'fitness-gym', 'conditioning'],
    ['LES MILLS BODYATTACK', 'fitness-gym', 'conditioning'],
    ['LES MILLS BODYCOMBAT', 'fitness-gym', 'conditioning'],
    ['LES MILLS BODYJAM', 'fitness-gym', 'conditioning'],
    ['LES MILLS BODYSTEP', 'fitness-gym', 'conditioning'],
    ['LES MILLS GRIT Athletic', 'fitness-gym', 'conditioning'],
    ['LES MILLS GRIT Cardio', 'fitness-gym', 'conditioning'],
    ["LES MILLS SH'BAM", 'fitness-gym', 'conditioning'],
    ['LES MILLS TONE', 'fitness-gym', 'conditioning'],
    ['Barre', 'fitness-gym', 'mobility-fitness'],
    ['Mobility', 'fitness-gym', 'mobility-fitness'],
    ['Dynamic Mobility', 'fitness-gym', 'mobility-fitness'],
    ['Static Mobility', 'fitness-gym', 'mobility-fitness'],
    ['Mind-Body Training', 'fitness-gym', 'mobility-fitness'],
    ['Physical Therapy', 'fitness-gym', 'mobility-fitness'],
    ['LES MILLS BARRE', 'fitness-gym', 'mobility-fitness'],
    ['LES MILLS BODYBALANCE', 'fitness-gym', 'mobility-fitness'],
    ['Indoor Skiing', 'fitness-gym', 'general-fitness'],
    ['Indoor Grinding', 'fitness-gym', 'general-fitness'],
    ['Trucker Workout', 'fitness-gym', 'general-fitness'],
  ])('includes %s in the approved family/context without changing its name', (name, sport, context) => {
    expect(resolveTrainingSportContextFromActivityType(name)).toMatchObject({ sport, context });
    expect(resolveTrainingSportContextFromActivityType(`  ${name.toLowerCase()}  `))
      .toMatchObject({ sport, context });
  });

  it.each([
    ['Classic Roller Skiing', ActivityTypes.RollerSki],
    ['Skate Roller Skiing', ActivityTypes.RollerSki],
    ['Virtual Rowing', ActivityTypes.IndoorRowing],
    ['Whitewater Kayaking', ActivityTypes.Kayaking],
  ])('gives %s the existing %s analysis policies without widening planning support', (sport, baseSport) => {
    expect(resolveTrainingSportContextFromActivityType(sport))
      .toEqual(resolveTrainingSportContextFromActivityType(baseSport));
    expect(resolveTrainingSportContextFromActivityType(sport)).toMatchObject({
      intensityPolicy: 'zones', loadPolicy: 'recorded', durabilityPolicy: 'omit',
    });
    expect(resolveTrainingPowerSystemsModelActivityType(sport)).toBe(sport);
    expect(MANUAL_WORKOUT_EDITOR_SPORTS_V1 as readonly string[]).not.toContain(sport);
  });

  it('keeps saved TSS available for every Training context independently of specialist policies', () => {
    TRAINING_SPORT_DEFINITIONS.forEach(sport => sport.contexts.forEach(context => {
      expect(context.loadPolicy).toBe('recorded');
    }));
    ['BMX', 'Kickbiking', 'Obstacle Racing'].forEach(type => {
      expect(resolveTrainingSportContextFromActivityType(type)?.durabilityPolicy).toBe('omit');
    });
    expect(resolveTrainingSportContextFromActivityType('BMX')?.intensityPolicy).toBe('volume-only');
    ['Kickbiking', 'Obstacle Racing'].forEach(type => {
      expect(resolveTrainingSportContextFromActivityType(type)?.intensityPolicy).toBe('zones');
    });
    ['Enduro MTB', 'E-Enduro MTB', 'Downhill Cycling'].forEach(type => {
      expect(resolveTrainingSportContextFromActivityType(type)?.durabilityPolicy).toBe('unsupported-context');
    });
    ['Track Running', 'Ultra Running', 'Crosscountry Running', 'Recumbent Cycling',
      'Indoor Hand Cycle', 'E-Mountain Biking', 'Mountain Bike Orienteering'].forEach(type => {
      expect(resolveTrainingSportContextFromActivityType(type)?.durabilityPolicy).toBe('supported');
    });
  });

  it('pools rolling power model history only for generic and road cycling/running pairs', () => {
    ['Cycling', 'Road Cycling'].forEach(type => expect(resolveTrainingPowerSystemsModelActivityType(type)).toBe(ActivityTypes.Cycling));
    ['Running', 'Road Running'].forEach(type => expect(resolveTrainingPowerSystemsModelActivityType(type)).toBe(ActivityTypes.Running));
    ['Indoor Cycling', 'Mountain Biking', 'Gravel Cycling', 'Track Running', 'BMX', 'Kickbiking', 'Obstacle Racing']
      .forEach(type => expect(resolveTrainingPowerSystemsModelActivityType(type)).toBe(type));
    expect(resolveTrainingPowerSystemsModelActivityType('Provider Mystery')).toBeNull();
  });

  it('normalizes account-saved Training destinations to a safe overview fallback', () => {
    expect(normalizeTrainingDestinationId('overview')).toBe('overview');
    expect(normalizeTrainingDestinationId('cycling')).toBe('cycling');
    expect(normalizeTrainingDestinationId('other-power')).toBe('other-power');
    expect(normalizeTrainingDestinationId('unknown')).toBe('overview');
    expect(normalizeTrainingDestinationId(null)).toBe('overview');
  });

  it('classifies every declared canonical activity type exactly once', () => {
    const memberships = TRAINING_SPORT_DEFINITIONS.flatMap(sport => sport.contexts.flatMap(context => (
      context.activityTypes.map(activityType => ({ sport: sport.id, context: context.id, activityType }))
    )));

    expect(new Set(memberships.map(({ activityType }) => activityType)).size).toBe(memberships.length);
    memberships.forEach(({ sport, context, activityType }) => {
      expect(resolveTrainingDisciplineFromActivityType(activityType)).toBe(sport);
      expect(resolveTrainingSportContextFromActivityType(activityType)).toMatchObject({
        sport: sport,
        context: context,
      });
    });
  });

  it('resolves provider aliases through sports-lib before applying exact context membership', () => {
    expect(resolveTrainingDisciplineFromActivityType('cycling_mountain')).toBe('cycling');
    expect(resolveTrainingDisciplineFromActivityType('swimming_open_water')).toBe('swimming');
    expect(resolveTrainingDisciplineFromActivityType('indoor_rowing')).toBe('rowing');
    expect(resolveTrainingDisciplineFromActivityType('nordic_walking')).toBe('walking-hiking');
    expect(resolveTrainingDisciplineFromActivityType('cross_country_skiing')).toBe('nordic-skiing');
    expect(resolveTrainingDisciplineFromActivityType('strength_training')).toBe('strength');
    expect(resolveTrainingDisciplineFromActivityType('stand_up_paddleboarding')).toBe('paddling');
    expect(resolveTrainingDisciplineFromActivityType('training')).toBe('fitness-gym');
    expect(resolveTrainingDisciplineFromActivityType('indoor_training')).toBe('fitness-gym');
  });

  it('keeps endurance MTB, Enduro, and Downhill in Cycling with distinct policies', () => {
    expect(resolveTrainingSportContextFromActivityType(ActivityTypes.MountainBiking)).toMatchObject({
      sport: 'cycling',
      context: 'mountain-biking',
      profile: 'endurance',
      intensityPolicy: 'zones',
      loadPolicy: 'recorded',
    });
    expect(resolveTrainingSportContextFromActivityType(ActivityTypes['Enduro MTB'])).toMatchObject({
      sport: 'cycling',
      context: 'enduro',
      profile: 'mixed-gravity',
      intensityPolicy: 'volume-only',
      loadPolicy: 'recorded',
    });
    expect(resolveTrainingSportContextFromActivityType(ActivityTypes.DownhillCycling)).toMatchObject({
      sport: 'cycling',
      context: 'downhill',
      profile: 'gravity',
      intensityPolicy: 'volume-only',
      loadPolicy: 'recorded',
    });

    const cycling = getTrainingSportDefinition('cycling');
    ['mountain-biking', 'enduro', 'downhill'].forEach((contextId) => {
      expect(cycling?.contexts.find(context => context.id === contextId)?.profileMetrics)
        .toContain('max-jump-distance');
    });
    expect(TRAINING_PROFILE_METRIC_DEFINITIONS.find(metric => metric.id === 'max-jump-distance'))
      .toMatchObject({
        label: 'Longest jump',
        aggregation: 'maximum',
        unit: 'jump-distance',
        statTypes: ['Maximum Jump Distance', 'Jump Distance Max'],
      });
  });

  it('keeps Hand Cycle and Velomobile in the standard Cycling context', () => {
    [ActivityTypes.Handcycle, ActivityTypes.Velomobile].forEach((activityType) => {
      expect(resolveTrainingSportContextFromActivityType(activityType)).toMatchObject({
        sport: 'cycling',
        context: 'cycling',
        profile: 'endurance',
        intensityPolicy: 'zones',
        loadPolicy: 'recorded',
      });
    });
  });

  it('keeps Fitness & Gym intensity separate from recorded TSS for generic training and classes', () => {
    [
      ActivityTypes.Crossfit,
      ActivityTypes.Training,
      ActivityTypes['Indoor Training'],
      ActivityTypes.HIIT,
      ActivityTypes['Cardio Training'],
      ActivityTypes.Yoga,
    ].forEach(activityType => expect(resolveTrainingSportContextFromActivityType(activityType)).toMatchObject({
      sport: 'fitness-gym',
      profile: 'general',
      intensityPolicy: 'volume-only',
      loadPolicy: 'recorded',
      distancePolicy: 'omit',
    }));
  });

  it('places known unmodeled sports in Other Training without classifying aggregate parents', () => {
    [
      ActivityTypes.SkiTouring,
      ActivityTypes.BackCountrySkiing,
      ActivityTypes.Snowshoeing,
      ActivityTypes.Surfing,
      ActivityTypes.Sailing,
    ].forEach(activityType => expect(resolveTrainingSportContextFromActivityType(activityType)).toMatchObject({
      sport: 'other-training',
      context: 'other-training',
      profile: 'general',
      intensityPolicy: 'volume-only',
      loadPolicy: 'recorded',
      distancePolicy: 'omit',
    }));
    [ActivityTypes.Triathlon, ActivityTypes.Multisport, ActivityTypes.Transition, ActivityTypes.Route,
      'Brick Training', 'Pool Triathlon', 'Offroad Triathlon', 'Offroad Duathlon']
      .forEach(activityType => expect(resolveTrainingDisciplineFromActivityType(activityType)).toBeNull());
    expect(resolveTrainingDisciplineFromActivityType('not-a-sport')).toBeNull();
    expect(resolveTrainingDisciplineFromActivityType('__proto__')).toBeNull();
    expect(resolveTrainingDisciplineFromActivityType('toString')).toBeNull();
    expect(resolveTrainingDisciplineFromActivityType({ toString: () => ActivityTypes.Running })).toBeNull();
  });

  it('derives reusable records and capabilities from the registry', () => {
    expect(createTrainingSportRecord(sport => sport.label)).toEqual({
      running: 'Running',
      cycling: 'Cycling',
      swimming: 'Swimming',
      rowing: 'Rowing',
      'walking-hiking': 'Walking & Hiking',
      'nordic-skiing': 'Nordic Skiing',
      strength: 'Strength',
      'fitness-gym': 'Fitness & Gym',
      paddling: 'Paddling',
      'other-training': 'Other training',
    });
    expect(getTrainingSportDefinition('cycling')?.capabilities).toContain('durability');
    expect(getTrainingSportDefinition('rowing')?.capabilities).not.toContain('durability');
    expect(getTrainingSportDefinition('strength')?.capabilities).toEqual(['training-mix', 'best-build', 'power-systems']);
    expect(getTrainingSportDefinition('fitness-gym')?.capabilities).toEqual(['training-mix']);
    expect(getTrainingSportDefinition('other-training')?.capabilities).toEqual(['training-mix']);
    expect(getTrainingSportDefinition('fitness-gym')?.selectionAvailability).toBe('recorded');
    expect(getTrainingSportDefinition('other-training')?.selectionAvailability).toBe('recorded');
    const sportIds = TRAINING_SPORT_DEFINITIONS.map(sport => sport.id);
    const contextIds = TRAINING_SPORT_DEFINITIONS.flatMap(sport => sport.contexts.map(context => context.id));
    expect(new Set(sportIds).size).toBe(sportIds.length);
    expect(new Set(contextIds).size).toBe(contextIds.length);
    const metricIds = TRAINING_PROFILE_METRIC_DEFINITIONS.map(metric => metric.id);
    expect(new Set(metricIds).size).toBe(metricIds.length);
    TRAINING_SPORT_DEFINITIONS.flatMap(sport => sport.contexts).forEach((context) => {
      expect(new Set(context.profileMetrics).size).toBe(context.profileMetrics.length);
      expect(context.profileMetrics.every(metric => metricIds.includes(metric))).toBe(true);
    });
  });
});
