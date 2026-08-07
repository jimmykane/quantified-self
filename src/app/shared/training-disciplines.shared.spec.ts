import { ActivityTypes } from '@sports-alliance/sports-lib';
import {
  createTrainingSportRecord,
  getTrainingSportDefinition,
  resolveTrainingDisciplineFromActivityType,
  resolveTrainingSportContextFromActivityType,
  TRAINING_DISCIPLINES,
  TRAINING_PROFILE_METRIC_DEFINITIONS,
  TRAINING_SPORT_DEFINITIONS,
} from '@shared/training-disciplines';

describe('shared Training sport registry', () => {
  it('defines the eight curated sport families in presentation order', () => {
    expect(TRAINING_DISCIPLINES).toEqual([
      'running',
      'cycling',
      'swimming',
      'rowing',
      'walking-hiking',
      'nordic-skiing',
      'strength',
      'paddling',
    ]);
    expect(TRAINING_SPORT_DEFINITIONS.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'running', label: 'Running' },
      { id: 'cycling', label: 'Cycling' },
      { id: 'swimming', label: 'Swimming' },
      { id: 'rowing', label: 'Rowing' },
      { id: 'walking-hiking', label: 'Walking & Hiking' },
      { id: 'nordic-skiing', label: 'Nordic Skiing' },
      { id: 'strength', label: 'Strength' },
      { id: 'paddling', label: 'Paddling' },
    ]);
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
      loadPolicy: 'volume-only',
    });
    expect(resolveTrainingSportContextFromActivityType(ActivityTypes.DownhillCycling)).toMatchObject({
      sport: 'cycling',
      context: 'downhill',
      profile: 'gravity',
      intensityPolicy: 'volume-only',
      loadPolicy: 'volume-only',
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

  it('keeps intentionally unsupported broad-family members in Other', () => {
    [
      ActivityTypes.Crossfit,
      ActivityTypes.SkiTouring,
      ActivityTypes.BackCountrySkiing,
      ActivityTypes.Snowshoeing,
      ActivityTypes.Surfing,
      ActivityTypes.Sailing,
      ActivityTypes.Triathlon,
      ActivityTypes.Multisport,
    ].forEach(activityType => expect(resolveTrainingDisciplineFromActivityType(activityType)).toBeNull());
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
      paddling: 'Paddling',
    });
    expect(getTrainingSportDefinition('cycling')?.capabilities).toContain('durability');
    expect(getTrainingSportDefinition('rowing')?.capabilities).not.toContain('durability');
    expect(getTrainingSportDefinition('strength')?.capabilities).toEqual(['training-mix', 'best-build']);
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
