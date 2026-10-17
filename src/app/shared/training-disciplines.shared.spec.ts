import { APPROVED_REMAINING_SPORT_CASES, APPROVED_OTHER_TRAINING_NAMES } from '@shared/testing/training-remaining-sport-cases';
import { APPROVED_WATER_TEAM_SPORT_CASES } from '@shared/testing/training-water-team-cases';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { resolveActivityTypeMaterialIcon } from '../helpers/activity-type-presentation.helper';
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

  it.each(APPROVED_WATER_TEAM_SPORT_CASES)('preserves $name in its approved Training context and exact power history', item => {
    const resolved = resolveTrainingSportContextFromActivityType(item.name);
    expect(resolved).toMatchObject({ sport: item.sport, context: item.context, profile: item.profile,
      intensityPolicy: item.zones ? 'zones' : 'volume-only', profileMetrics: item.metrics,
      loadPolicy: 'recorded', durabilityPolicy: 'omit', distancePolicy: item.zones ? 'recorded' : 'omit',
    });
    expect(resolveTrainingSportContextFromActivityType(`  ${item.name.toLowerCase()}  `)).toEqual(resolved);
    expect(resolveTrainingPowerSystemsModelActivityType(item.name)).toBe(item.name);
    const definition = getTrainingSportDefinition(item.sport);
    expect(definition?.contexts.find(context => context.id === item.context)).toMatchObject({
      label: item.name, activityTypes: [item.name], showElapsedTimeInSummary: true, showElapsedTimeInComparison: true,
    });
    expect(definition?.capabilities).toEqual(['training-mix', 'best-build', 'power-systems']);
    expect(MANUAL_WORKOUT_EDITOR_SPORTS_V1 as readonly string[]).not.toContain(item.name);
  });

  it.each(APPROVED_REMAINING_SPORT_CASES)('classifies $name with the approved final duration/saved-load policy', item => {
    const resolved = resolveTrainingSportContextFromActivityType(item.name);
    expect(resolved).toEqual({ sport: item.sport, context: item.context, profile: 'general',
      intensityPolicy: 'volume-only', profileMetrics: ['elapsed-time'], loadPolicy: 'recorded',
      durabilityPolicy: 'omit', distancePolicy: 'omit' });
    expect(resolveTrainingSportContextFromActivityType(`  ${item.name.toLowerCase()}  `)).toEqual(resolved);
    expect(resolveTrainingPowerSystemsModelActivityType(item.name)).toBe(item.name);
    const definition = getTrainingSportDefinition(item.sport);
    expect(definition?.contexts.find(context => context.id === item.context)).toMatchObject({
      label: item.name, activityTypes: [item.name], showElapsedTimeInSummary: true, showElapsedTimeInComparison: true,
    });
    expect(definition?.capabilities).toEqual(item.sport === 'fitness-gym'
      ? ['training-mix'] : ['training-mix', 'best-build', 'power-systems']);
    expect(MANUAL_WORKOUT_EDITOR_SPORTS_V1 as readonly string[]).not.toContain(item.name);
  });

  it.each(APPROVED_OTHER_TRAINING_NAMES)('deliberately retains %s in Other training with its exact name', name => {
    expect(resolveTrainingSportContextFromActivityType(name)).toEqual({ sport: 'other-training', context: 'other-training',
      profile: 'general', intensityPolicy: 'volume-only', profileMetrics: ['elapsed-time'],
      loadPolicy: 'recorded', durabilityPolicy: 'omit', distancePolicy: 'omit' });
    expect(resolveTrainingPowerSystemsModelActivityType(name)).toBe(name);
  });

  it('discovers the final four groups with existing Material icons and benchmark capability', () => {
    const groups = [['performance-sports', 'workspace_premium'], ['outdoor-adventures', 'hiking'],
      ['aerial-sports', 'paragliding'], ['motorized-activities', 'directions_car']] as const;
    groups.forEach(([id, icon]) => {
      const definition = getTrainingSportDefinition(id);
      expect(definition?.selectionAvailability).toBe('recorded');
      expect(resolveActivityTypeMaterialIcon(definition?.iconActivityType)).toBe(icon);
      expect(normalizeTrainingDestinationId(id)).toBe(id);
      expect(definition?.capabilities).toEqual(['training-mix', 'best-build', 'power-systems']);
    });
  });

  it('discovers the three new groups with existing Material icons', () => {
    const groups = [['precision-sports', 'sports_golf'], ['water-sports', 'surfing'], ['diving', 'scuba_diving']] as const;
    groups.forEach(([id, icon]) => {
      const definition = getTrainingSportDefinition(id);
      expect(definition?.selectionAvailability).toBe('recorded');
      expect(resolveActivityTypeMaterialIcon(definition?.iconActivityType)).toBe(icon);
      expect(normalizeTrainingDestinationId(id)).toBe(id);
    });
    expect(resolveTrainingSportContextFromActivityType('Indoor Grinding')?.sport).toBe('fitness-gym');
    expect(resolveTrainingSportContextFromActivityType('Grinding')?.context).toBe('grinding');
    ['Hockey', 'Field Hockey', 'Ice Hockey', 'Sled Hockey'].forEach(name => {
      expect(resolveTrainingSportContextFromActivityType(name)?.context).toBe(name.toLowerCase().replaceAll(' ', '-'));
    });
  });

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
      'wheelchair',
      'climbing-mountaineering',
      'mountain-snow',
      'skating',
      'combat-martial-arts',
      'dance',
      'team-sports',
      'racket-sports',
      'precision-sports',
      'water-sports',
      'diving',
      'performance-sports',
      'outdoor-adventures',
      'aerial-sports',
      'motorized-activities',
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
      { id: 'wheelchair', label: 'Wheelchair Training' },
      { id: 'climbing-mountaineering', label: 'Climbing & Mountaineering' },
      { id: 'mountain-snow', label: 'Mountain Snow Sports' },
      { id: 'skating', label: 'Skating' },
      { id: 'combat-martial-arts', label: 'Combat & Martial Arts' },
      { id: 'dance', label: 'Dance' },
      { id: 'team-sports', label: 'Team Sports' },
      { id: 'racket-sports', label: 'Racket Sports' },
      { id: 'precision-sports', label: 'Precision Sports' },
      { id: 'water-sports', label: 'Water Sports' },
      { id: 'diving', label: 'Diving' },

      { id: 'performance-sports', label: 'Performance Sports' },
      { id: 'outdoor-adventures', label: 'Outdoor Adventures' },
      { id: 'aerial-sports', label: 'Aerial Sports' },
      { id: 'motorized-activities', label: 'Motorized Activities' },
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

  it.each([
    ['Rucking', 'walking-hiking', 'rucking', 'zones', 'recorded'],
    ['Orienteering', 'running', 'orienteering', 'zones', 'recorded'],
    ['Ski Orienteering', 'nordic-skiing', 'ski-orienteering', 'zones', 'recorded'],
    ['Biathlon', 'nordic-skiing', 'biathlon', 'zones', 'recorded'],
    ['Fitness Racing', 'fitness-gym', 'conditioning', 'volume-only', 'omit'],
    ['Aqua Fitness', 'fitness-gym', 'conditioning', 'volume-only', 'omit'],
    ['Water Running', 'fitness-gym', 'water-running', 'zones', 'omit'],
    ['Wheel Chair', 'wheelchair', 'wheelchair-general', 'zones', 'recorded'],
    ['Wheelchair Push Walk', 'wheelchair', 'wheelchair-push-walk', 'zones', 'recorded'],
    ['Wheelchair Push Run', 'wheelchair', 'wheelchair-push-run', 'zones', 'recorded'],
    ['Indoor Wheelchair Push Walk', 'wheelchair', 'indoor-wheelchair-push-walk', 'zones', 'recorded'],
    ['Indoor Wheelchair Push Run', 'wheelchair', 'indoor-wheelchair-push-run', 'zones', 'recorded'],
    ['Wheelchair Racing', 'wheelchair', 'wheelchair-racing', 'zones', 'recorded'],
  ])('classifies %s for recorded analysis with the approved policies', (name, sport, context, intensityPolicy, distancePolicy) => {
    expect(resolveTrainingSportContextFromActivityType(name)).toMatchObject({
      sport, context, intensityPolicy, distancePolicy, loadPolicy: 'recorded', durabilityPolicy: 'omit',
    });
    expect(resolveTrainingSportContextFromActivityType(`  ${name.toLowerCase()}  `))
      .toEqual(resolveTrainingSportContextFromActivityType(name));
    expect(resolveTrainingPowerSystemsModelActivityType(name)).toBe(name);
    expect(MANUAL_WORKOUT_EDITOR_SPORTS_V1 as readonly string[]).not.toContain(name);
  });


  it('classifies floor climbing separately from rock climbing and gym stair equipment', () => {
    expect(resolveTrainingSportContextFromActivityType('floor_climbing')).toMatchObject({
      sport: 'fitness-gym', context: 'stair-climbing', profile: 'general',
      intensityPolicy: 'zones', loadPolicy: 'recorded', durabilityPolicy: 'omit', distancePolicy: 'omit',
      profileMetrics: ['elapsed-time', 'ascent'],
    });
    expect(resolveTrainingSportContextFromActivityType(ActivityTypes.FloorClimbing))
      .toEqual(resolveTrainingSportContextFromActivityType('floor_climbing'));
    expect(resolveTrainingPowerSystemsModelActivityType(ActivityTypes.FloorClimbing)).toBe(ActivityTypes.FloorClimbing);
    expect(resolveTrainingSportContextFromActivityType(ActivityTypes['Stair Stepper'])?.context).toBe('conditioning');
    [ActivityTypes.Climbing, ActivityTypes.RockClimbing, ActivityTypes['Indoor Climbing']].forEach(type => {
      expect(resolveTrainingSportContextFromActivityType(type)?.sport).toBe('climbing-mountaineering');
    });
    expect(getTrainingSportDefinition('fitness-gym')?.capabilities).toEqual(['training-mix']);
    expect(getTrainingSportDefinition('fitness-gym')?.contexts.find(context => context.id === 'stair-climbing')?.label)
      .toBe('Stair Climbing');
  });

  it.each([
    ['Snowshoeing', 'walking-hiking', 'snowshoeing', 'zones', ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent']],
    ['Bouldering', 'climbing-mountaineering', 'bouldering', 'volume-only', ['elapsed-time', 'ascent']],
    ['Climbing', 'climbing-mountaineering', 'climbing', 'volume-only', ['elapsed-time', 'ascent']],
    ['Rock Climbing', 'climbing-mountaineering', 'rock-climbing', 'volume-only', ['elapsed-time', 'ascent']],
    ['Indoor Climbing', 'climbing-mountaineering', 'indoor-climbing', 'volume-only', ['elapsed-time', 'ascent']],
    ['Via Ferrata', 'climbing-mountaineering', 'via-ferrata', 'volume-only', ['elapsed-time', 'ascent']],
    ['Mountaineering', 'climbing-mountaineering', 'mountaineering', 'zones', ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent']],
    ['Ski Touring', 'mountain-snow', 'ski-touring', 'zones', ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time']],
    ['Ski Mountaineering', 'mountain-snow', 'ski-mountaineering', 'zones', ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time']],
    ['Backcountry Skiing', 'mountain-snow', 'backcountry-skiing', 'zones', ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time']],
    ['Backcountry Snowboarding', 'mountain-snow', 'backcountry-snowboarding', 'zones', ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time']],
    ['Splitboarding', 'mountain-snow', 'splitboarding', 'zones', ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time']],
    ['Alpine Skiing', 'mountain-snow', 'alpine-skiing', 'volume-only', ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time']],
    ['Snowboarding', 'mountain-snow', 'snowboarding', 'volume-only', ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time']],
    ['Telemark Skiing', 'mountain-snow', 'telemark-skiing', 'volume-only', ['distance', 'moving-time', 'elapsed-time', 'ascent', 'descent', 'descent-time']],
    ['Inline Skating', 'skating', 'inline-skating', 'zones', ['distance', 'moving-time', 'elapsed-time']],
    ['Skating', 'skating', 'skating', 'volume-only', ['distance', 'moving-time', 'elapsed-time']],
    ['Ice Skating', 'skating', 'ice-skating', 'volume-only', ['distance', 'moving-time', 'elapsed-time']],
    ['Skateboarding', 'skating', 'skateboarding', 'volume-only', ['distance', 'moving-time', 'elapsed-time']],
    ['Boxing', 'combat-martial-arts', 'boxing', 'volume-only', ['elapsed-time']],
    ['Combat', 'combat-martial-arts', 'combat', 'volume-only', ['elapsed-time']],
    ['Judo', 'combat-martial-arts', 'judo', 'volume-only', ['elapsed-time']],
    ['Kickboxing', 'combat-martial-arts', 'kickboxing', 'volume-only', ['elapsed-time']],
    ['Mixed Martial Arts', 'combat-martial-arts', 'mixed-martial-arts', 'volume-only', ['elapsed-time']],
    ['Taekwondo', 'combat-martial-arts', 'taekwondo', 'volume-only', ['elapsed-time']],
    ['Ballet Dancing', 'dance', 'ballet-dancing', 'volume-only', ['elapsed-time']],
    ['Ballroom Dancing', 'dance', 'ballroom-dancing', 'volume-only', ['elapsed-time']],
    ['Dancing', 'dance', 'dancing', 'volume-only', ['elapsed-time']],
    ['Jazz Dancing', 'dance', 'jazz-dancing', 'volume-only', ['elapsed-time']],
    ['Latin Dancing', 'dance', 'latin-dancing', 'volume-only', ['elapsed-time']],
    ['Modern Dancing', 'dance', 'modern-dancing', 'volume-only', ['elapsed-time']],
    ['Show Dancing', 'dance', 'show-dancing', 'volume-only', ['elapsed-time']],
    ['Street Dancing', 'dance', 'street-dancing', 'volume-only', ['elapsed-time']],
    ['Basketball', 'team-sports', 'basketball', 'volume-only', ['elapsed-time']],
    ['Wheelchair Basketball', 'team-sports', 'wheelchair-basketball', 'volume-only', ['elapsed-time']],
    ['Football', 'team-sports', 'football', 'volume-only', ['elapsed-time']],
    ['Soccer', 'team-sports', 'soccer', 'volume-only', ['elapsed-time']],
    ['Volleyball', 'team-sports', 'volleyball', 'volume-only', ['elapsed-time']],
    ['Beach Volleyball', 'team-sports', 'beach-volleyball', 'volume-only', ['elapsed-time']],
    ['Badminton', 'racket-sports', 'badminton', 'volume-only', ['elapsed-time']],
    ['Beach Tennis', 'racket-sports', 'beach-tennis', 'volume-only', ['elapsed-time']],
    ['Padel', 'racket-sports', 'padel', 'volume-only', ['elapsed-time']],
    ['Pickleball', 'racket-sports', 'pickleball', 'volume-only', ['elapsed-time']],
    ['Platform Tennis', 'racket-sports', 'platform-tennis', 'volume-only', ['elapsed-time']],
    ['Racket Sport', 'racket-sports', 'racket-sport', 'volume-only', ['elapsed-time']],
    ['Racquet Ball', 'racket-sports', 'racquet-ball', 'volume-only', ['elapsed-time']],
    ['Squash', 'racket-sports', 'squash', 'volume-only', ['elapsed-time']],
    ['Table Tennis', 'racket-sports', 'table-tennis', 'volume-only', ['elapsed-time']],
    ['Tennis', 'racket-sports', 'tennis', 'volume-only', ['elapsed-time']],
    ['Wheelchair Tennis', 'racket-sports', 'wheelchair-tennis', 'volume-only', ['elapsed-time']],
  ] as const)('preserves %s in its approved recorded context and exact power history', (name, sport, context, intensityPolicy, metrics) => {
    const resolved = resolveTrainingSportContextFromActivityType(name);
    expect(resolved).toMatchObject({ sport, context, intensityPolicy, profileMetrics: metrics,
      loadPolicy: 'recorded', durabilityPolicy: 'omit', distancePolicy: metrics.some(metric => metric === 'distance') ? 'recorded' : 'omit',
    });
    expect(resolveTrainingSportContextFromActivityType(`  ${name.toLowerCase()}  `)).toEqual(resolved);
    expect(resolveTrainingPowerSystemsModelActivityType(name)).toBe(name);
    const definition = getTrainingSportDefinition(sport);
    expect(definition?.contexts.find(item => item.id === context)).toMatchObject({
      label: name, activityTypes: [name], showElapsedTimeInSummary: true, showElapsedTimeInComparison: true,
    });
    expect(definition?.capabilities).toEqual(['training-mix', 'best-build', 'power-systems']);
  });

  it('uses existing Material icons and recorded discovery for the seven new groups', () => {
    const expectedIcons = [
      ['climbing-mountaineering', 'hiking'], ['mountain-snow', 'downhill_skiing'], ['skating', 'roller_skating'],
      ['combat-martial-arts', 'fitness_center'], ['dance', 'fitness_center'],
      ['team-sports', 'sports_basketball'], ['racket-sports', 'sports_tennis'],
    ] as const;
    expectedIcons.forEach(([id, icon]) => {
      const definition = getTrainingSportDefinition(id);
      expect(definition?.selectionAvailability).toBe('recorded');
      expect(resolveActivityTypeMaterialIcon(definition?.iconActivityType)).toBe(icon);
      expect(normalizeTrainingDestinationId(id)).toBe(id);
    });
    expect(resolveTrainingDisciplineFromActivityType('Wheelchair Basketball')).toBe('team-sports');
    expect(resolveTrainingDisciplineFromActivityType('Wheelchair Tennis')).toBe('racket-sports');
    expect(resolveTrainingDisciplineFromActivityType('Fitness Boxing')).toBe('fitness-gym');
    expect(resolveTrainingDisciplineFromActivityType('Fitness Dancing')).toBe('fitness-gym');
    expect(resolveTrainingDisciplineFromActivityType('Fitness Martial Arts')).toBe('fitness-gym');
  });

  it('gives recorded wheelchair training its own supported views and existing Material icon', () => {
    const sport = getTrainingSportDefinition('wheelchair');
    expect(sport?.capabilities).toEqual(['training-mix', 'best-build', 'power-systems']);
    expect(sport?.selectionAvailability).toBe('recorded');
    expect(sport?.contexts).toHaveLength(6);
    expect(resolveActivityTypeMaterialIcon(sport?.iconActivityType)).toBe('accessible_forward');
    expect(normalizeTrainingDestinationId('wheelchair')).toBe('wheelchair');
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
    APPROVED_OTHER_TRAINING_NAMES.forEach(activityType => expect(resolveTrainingSportContextFromActivityType(activityType)).toMatchObject({
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
      wheelchair: 'Wheelchair Training',
      'climbing-mountaineering': 'Climbing & Mountaineering',
      'mountain-snow': 'Mountain Snow Sports',
      'skating': 'Skating',
      'combat-martial-arts': 'Combat & Martial Arts',
      'dance': 'Dance',
      'team-sports': 'Team Sports',
      'racket-sports': 'Racket Sports',
      'precision-sports': 'Precision Sports',
      'water-sports': 'Water Sports',
      'diving': 'Diving',

      'performance-sports': 'Performance Sports',
      'outdoor-adventures': 'Outdoor Adventures',
      'aerial-sports': 'Aerial Sports',
      'motorized-activities': 'Motorized Activities',
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
