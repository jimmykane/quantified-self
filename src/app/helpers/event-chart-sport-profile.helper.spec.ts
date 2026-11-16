import { describe, expect, it } from 'vitest';
import {
  ActivityTypeGroups,
  ActivityTypes,
  ActivityTypesHelper,
  DataAirPower,
  DataAltitude,
  DataCadence,
  DataDepth,
  DataDepthFeet,
  DataEPOC,
  DataHeartRate,
  DataPace,
  DataPaceMinutesPerMile,
  DataPower,
  DataPowerLeft,
  DataPowerRight,
  DataSeaLevelPressure,
  DataSpeed,
  DataSpeedKnots,
  DataStrokeRate,
  DataSwimPace,
  DataTemperature,
  DataVerticalSpeed,
} from '@sports-alliance/sports-lib';
import {
  getEventChartMetricFamily,
  getEventChartSelectionKey,
  getUnclassifiedEventChartActivityTypes,
  resolveEventChartRecommendations,
  resolveEventChartSportProfile,
} from './event-chart-sport-profile.helper';

describe('event chart sport profiles', () => {
  const altitudeProfileCases = [
    {
      activityTypes: [ActivityTypes.Running, 'Road Running'],
      primaryDataTypes: [DataHeartRate.type, DataPace.type, DataPower.type],
    },
    {
      activityTypes: [ActivityTypes.Walking, 'Nordic Walking', 'Speed Walking'],
      primaryDataTypes: [DataHeartRate.type, DataPace.type, DataPower.type],
    },
    {
      activityTypes: ['Cycling', 'Road Cycling', 'Gravel Cycling', 'Track Cycling', 'Cyclocross', 'E-Biking', 'Hand Cycle', 'Velomobile', 'Wheel Chair'],
      primaryDataTypes: [DataHeartRate.type, DataPower.type, DataSpeed.type],
    },
  ].flatMap(({activityTypes, primaryDataTypes}) => activityTypes.map(activityType => ({activityType, primaryDataTypes})));

  it('covers every canonical Sports Lib activity type with an explicit or group profile', () => {
    expect(ActivityTypesHelper.getActivityTypesAsUniqueArray().length).toBeGreaterThan(100);
    expect(getUnclassifiedEventChartActivityTypes()).toEqual([]);
  });

  it.each([
    ['Road Running', 'running'],
    ['Indoor Track Running', 'treadmill'],
    ['Vertical Running', 'trail-running'],
    ['Road Cycling', 'cycling'],
    ['Gravel Cycling', 'cycling'],
    ['Track Cycling', 'cycling'],
    ['Cyclocross', 'cycling'],
    ['LES MILLS RPM', 'indoor-cycling'],
    ['LES MILLS SPRINT', 'indoor-cycling'],
    ['LES MILLS THE TRIP', 'indoor-cycling'],
    ['Speed Walking', 'walking'],
    ['Indoor Walking', 'indoor-walking'],
    ['Classic Crosscountry Skiing', 'cross-country-skiing'],
    ['Skate Skiing', 'cross-country-skiing'],
    ['AMRAP', 'fitness'],
    ['EMOM', 'fitness'],
    ['Tabata', 'fitness'],
    ['LES MILLS BODYPUMP', 'fitness'],
    ['Virtual Rowing', 'indoor-rowing'],
    ['Indoor Hand Cycle', 'indoor-cycling'],
    ['Indoor Wheelchair Push Walk', 'indoor-cycling'],
    ['Indoor Wheelchair Push Run', 'indoor-cycling'],
    ['Classic Roller Skiing', 'cross-country-skiing'],
    ['Skate Roller Skiing', 'cross-country-skiing'],
    ['Ski Mountaineering', 'ski-touring'],
    ['Sail Racing', 'sailing'],
    ['Sailing Expedition', 'sailing'],
  ])('keeps %s named while reusing the compatible chart profile', (name, profileID) => {
    const resolution = resolveEventChartSportProfile([name]);
    expect(resolution.canonicalActivityTypes).toEqual([name]);
    expect(resolution.profileID).toBe(profileID);
    expect(resolution.label).toBe(name);
  });

  it.each([
    [['Indoor Walking', 'Walking'], 'walking'],
    [['Indoor Walking', 'Speed Walking'], 'walking'],
    [['Walking', 'Trekking'], 'hiking'],
  ])('keeps the mixed walking/hiking selection %s in %s', (types, profileID) => {
    const resolution = resolveEventChartSportProfile(types as string[]);
    expect(resolution.profileID).toBe(profileID);
    expect(resolution.source).toBe('shared-profile');
  });

  it('shares cycling recommendations with generic provider cycling and keeps indoor walking terrain-free', () => {
    expect(resolveEventChartSportProfile(['Cycling', 'Road Cycling']).profileID).toBe('cycling');
    expect(resolveEventChartSportProfile(['Indoor Walking']).candidateFamilies).not.toContain('altitude');
  });

  it('automatically recommends virtual-rowing speed and the library-owned rate stream', () => {
    const rateType = ActivityTypesHelper.usesStrokeRate('Virtual Rowing' as ActivityTypes)
      ? DataStrokeRate.type : DataCadence.type;
    const dataTypes = [DataHeartRate.type, DataSpeed.type, rateType];
    const recommendations = resolveEventChartRecommendations({
      profile: resolveEventChartSportProfile(['Virtual Rowing']),
      panels: dataTypes.map(dataType => ({ dataType })),
      globallyAllowedDataTypes: dataTypes,
    });
    expect(recommendations.automaticDataTypes).toEqual(dataTypes);
  });

  it.each(['Indoor Hand Cycle', 'Indoor Wheelchair Push Walk', 'Indoor Wheelchair Push Run'])(
    'omits outdoor terrain from the automatic %s profile', name => {
      const profile = resolveEventChartSportProfile([name]);
      expect(profile.candidateFamilies).not.toContain('altitude');
      expect(profile.candidateFamilies).not.toContain('vertical-speed');
      expect(profile.candidateFamilies).toContain('power');
      expect(profile.label).toBe(name);
    },
  );

  it.each([
    [ActivityTypes.Running, 'running', ['heart-rate', 'pace', 'power']],
    [ActivityTypes.TrailRunning, 'trail-running', ['pace', 'power', 'altitude']],
    [ActivityTypes.Cycling, 'cycling', ['heart-rate', 'power', 'speed']],
    [ActivityTypes.IndoorCycling, 'indoor-cycling', ['heart-rate', 'power', 'cadence']],
    [ActivityTypes.MountainBiking, 'mountain-biking', ['heart-rate', 'speed', 'altitude']],
    [ActivityTypes.Swimming, 'pool-swimming', ['heart-rate', 'swim-pace', 'stroke-rate']],
    [ActivityTypes.CrosscountrySkiing, 'cross-country-skiing', ['altitude', 'heart-rate', 'power']],
    [ActivityTypes.Transition, 'empty', []],
  ])('resolves %s to its required profile', (activityType, profileID, firstFamilies) => {
    const resolution = resolveEventChartSportProfile([activityType]);
    expect(resolution.profileID).toBe(profileID);
    expect(resolution.candidateFamilies.slice(0, firstFamilies.length)).toEqual(firstFamilies);
  });

  it.each([
    [ActivityTypes.InlineSkating, ActivityTypeGroups.SkatingGroup, 'ice-skating'],
    [ActivityTypes.Skating, ActivityTypeGroups.SkatingGroup, 'ice-skating'],
    [ActivityTypes.Flying, ActivityTypeGroups.AerialSportsGroup, 'paragliding'],
    [ActivityTypes.HangGliding, ActivityTypeGroups.AerialSportsGroup, 'paragliding'],
    [ActivityTypes.Jumpmaster, ActivityTypeGroups.AerialSportsGroup, 'sky-diving'],
    [ActivityTypes.Paragliding, ActivityTypeGroups.AerialSportsGroup, 'paragliding'],
    [ActivityTypes.SkyDiving, ActivityTypeGroups.AerialSportsGroup, 'sky-diving'],
    [ActivityTypes.Boating, ActivityTypeGroups.MotorizedGroup, 'sailing'],
    [ActivityTypes.Driving, ActivityTypeGroups.MotorizedGroup, 'motor'],
    [ActivityTypes.Motorcycling, ActivityTypeGroups.MotorizedGroup, 'motor'],
    [ActivityTypes.Motorsports, ActivityTypeGroups.MotorizedGroup, 'motor'],
    [ActivityTypes.Snowmobiling, ActivityTypeGroups.MotorizedGroup, 'snowmobiling'],
    [ActivityTypes.Wheelchair, ActivityTypeGroups.AdaptiveMobilityGroup, 'cycling'],
  ])('keeps the type-specific %s profile inside its Sports Lib group', (activityType, activityGroup, profileID) => {
    expect(ActivityTypesHelper.getActivityGroupForActivityType(activityType)).toBe(activityGroup);

    const resolution = resolveEventChartSportProfile([activityType]);

    expect(resolution.profileID).toBe(profileID);
    expect(resolution.source).toBe('exact');
  });

  it('prefers shared registered profiles before homogeneous Sports Lib groups', () => {
    const oneRun = resolveEventChartSportProfile([ActivityTypes.Running]);
    const repeatedRun = resolveEventChartSportProfile([ActivityTypes.Running, ActivityTypes.Running]);
    const cyclingAliases = resolveEventChartSportProfile([ActivityTypes.Cycling, ActivityTypes.EBiking]);
    const crossGroupCyclingAliases = resolveEventChartSportProfile([
      ActivityTypes.Cycling,
      ActivityTypes.Handcycle,
    ]);
    const crossCountryAliases = resolveEventChartSportProfile([
      ActivityTypes.CrosscountrySkiing,
      ActivityTypes.NordicSki,
    ]);
    const mixedCycling = resolveEventChartSportProfile([ActivityTypes.Cycling, ActivityTypes.IndoorCycling]);
    const mixedRunning = resolveEventChartSportProfile([ActivityTypes.Running, ActivityTypes.Treadmill]);
    const mixedMountainBiking = resolveEventChartSportProfile([
      ActivityTypes.MountainBiking,
      ActivityTypes['Enduro MTB'],
    ]);
    const mixedSwimming = resolveEventChartSportProfile([ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming]);
    const heterogeneous = resolveEventChartSportProfile([ActivityTypes.Running, ActivityTypes.Cycling]);
    const sharedProfileAcrossGroups = resolveEventChartSportProfile([ActivityTypes.Crossfit, ActivityTypes.Yoga]);

    expect(repeatedRun.signature).toBe(oneRun.signature);
    expect(cyclingAliases.profileID).toBe('cycling');
    expect(cyclingAliases.source).toBe('shared-profile');
    expect(crossGroupCyclingAliases.profileID).toBe('cycling');
    expect(crossGroupCyclingAliases.source).toBe('shared-profile');
    expect(crossCountryAliases.profileID).toBe('cross-country-skiing');
    expect(crossCountryAliases.source).toBe('shared-profile');
    expect(crossCountryAliases.candidateFamilies).toContain('power');
    expect(mixedCycling.profileID).toBe('cycling');
    expect(mixedCycling.source).toBe('shared-profile');
    expect(mixedRunning.profileID).toBe('running');
    expect(mixedRunning.source).toBe('shared-profile');
    expect(mixedMountainBiking.profileID).toBe('mountain-biking');
    expect(mixedMountainBiking.source).toBe('shared-profile');
    expect(mixedSwimming.profileID).toBe('open-water-swimming');
    expect(mixedSwimming.source).toBe('shared-profile');
    expect(heterogeneous.profileID).toBe('multisport');
    expect(heterogeneous.source).toBe('multisport');
    expect(sharedProfileAcrossGroups.profileID).toBe('fitness');
    expect(sharedProfileAcrossGroups.source).toBe('shared-profile');
  });

  it('maps every broader Sports Lib group to a deliberate shared presentation profile', () => {
    const cases = [
      {activityTypes: [ActivityTypes.Crossfit, ActivityTypes.Orienteering], profileID: 'performance-family'},
      {activityTypes: [ActivityTypes.IndoorRowing, ActivityTypes.Yoga], profileID: 'fitness'},
      {activityTypes: [ActivityTypes.Walking, ActivityTypes.Hiking], profileID: 'hiking'},
      {activityTypes: [ActivityTypes.CrosscountrySkiing, ActivityTypes.AlpineSkiing], profileID: 'alpine-skiing'},
      {activityTypes: [ActivityTypes.Sailing, ActivityTypes.Rowing], profileID: 'paddled-water'},
      {activityTypes: [ActivityTypes.ScubaDiving, ActivityTypes.Snorkeling], profileID: 'generic-diving'},
      {activityTypes: [ActivityTypes.Golf, ActivityTypes.Tennis], profileID: 'team-racket'},
      {activityTypes: [ActivityTypes.InlineSkating, ActivityTypes.Skating], profileID: 'ice-skating'},
      {activityTypes: [ActivityTypes.Paragliding, ActivityTypes.SkyDiving], profileID: 'paragliding'},
      {activityTypes: [ActivityTypes.Motorsports, ActivityTypes.Snowmobiling], profileID: 'motor'},
    ];

    cases.forEach(({activityTypes, profileID}) => {
      const resolution = resolveEventChartSportProfile(activityTypes);
      expect(resolution.profileID).toBe(profileID);
      expect(resolution.source).toBe('shared-profile');
    });

    const unspecified = resolveEventChartSportProfile([ActivityTypes.Workout, ActivityTypes.Paragliding]);
    expect(unspecified.profileID).toBe('multisport');
    expect(unspecified.source).toBe('multisport');
  });

  it.each([
    [[ActivityTypes.Paragliding, ActivityTypes.SkyDiving], 'paragliding', ['heart-rate', 'altitude', 'vertical-speed']],
    [[ActivityTypes.Motorsports, ActivityTypes.Snowmobiling], 'motor', ['speed', 'altitude', 'heart-rate']],
  ])('uses the shared %s group fallback only after exact profiles differ', (activityTypes, profileID, firstFamilies) => {
    const individualProfileIDs = activityTypes.map((activityType) => (
      resolveEventChartSportProfile([activityType]).profileID
    ));
    const resolution = resolveEventChartSportProfile(activityTypes);

    expect(new Set(individualProfileIDs).size).toBeGreaterThan(1);
    expect(resolution.profileID).toBe(profileID);
    expect(resolution.source).toBe('shared-profile');
    expect(resolution.candidateFamilies.slice(0, firstFamilies.length)).toEqual(firstFamilies);
  });

  it('keeps the Tactical fitness decision', () => {
    expect(resolveEventChartSportProfile([ActivityTypes.Tactical]).profileID).toBe('fitness');
  });

  it.each([
    ActivityTypes.Swimming,
    ActivityTypes.OpenWaterSwimming,
    ActivityTypes.Rowing,
    ActivityTypes.IndoorRowing,
    ActivityTypes.Canoeing,
    ActivityTypes.Kayaking,
    ActivityTypes.Paddling,
    ActivityTypes.StandUpPaddling,
  ])('uses Stroke Rate instead of Cadence for %s', (activityType) => {
    const resolution = resolveEventChartSportProfile([activityType]);

    expect(resolution.candidateFamilies).toContain('stroke-rate');
    expect(resolution.candidateFamilies).not.toContain('cadence');
  });

  it('keeps both rate semantics for a mixed water-sport profile', () => {
    const resolution = resolveEventChartSportProfile([
      ActivityTypes.Rowing,
      ActivityTypes.Surfing,
    ]);

    expect(resolution.profileID).toBe('paddled-water');
    expect(resolution.candidateFamilies).toContain('cadence');
    expect(resolution.candidateFamilies).toContain('stroke-rate');
  });

  it('selects a recorded Stroke Rate panel for open-water swimming', () => {
    const profile = resolveEventChartSportProfile([ActivityTypes.OpenWaterSwimming]);
    const result = resolveEventChartRecommendations({
      profile,
      panels: [
        panel(DataHeartRate.type),
        panel(DataSwimPace.type),
        panel(DataStrokeRate.type),
      ],
      globallyAllowedDataTypes: [
        DataHeartRate.type,
        DataSwimPace.type,
        DataStrokeRate.type,
      ],
    });

    expect(result.recommendedDataTypes).toEqual([
      DataHeartRate.type,
      DataSwimPace.type,
      DataStrokeRate.type,
    ]);
    expect(result.automaticDataTypes).toEqual([
      DataHeartRate.type,
      DataSwimPace.type,
      DataStrokeRate.type,
    ]);
  });

  it.each(altitudeProfileCases)('keeps primary charts and recorded altitude for $activityType', ({activityType, primaryDataTypes}) => {
    const dataTypes = [...primaryDataTypes, DataAltitude.type, DataCadence.type, DataTemperature.type];
    const result = resolveEventChartRecommendations({
      profile: resolveEventChartSportProfile([activityType]),
      panels: dataTypes.map(panel),
      globallyAllowedDataTypes: dataTypes,
    });

    expect(result.automaticDataTypes).toEqual([...primaryDataTypes, DataAltitude.type]);
  });

  it('keeps walking cadence when no power is recorded and adds altitude', () => {
    const dataTypes = [DataHeartRate.type, DataPace.type, DataCadence.type, DataAltitude.type];
    const result = resolveEventChartRecommendations({
      profile: resolveEventChartSportProfile([ActivityTypes.Walking]),
      panels: dataTypes.map(panel),
      globallyAllowedDataTypes: dataTypes,
    });

    expect(result.automaticDataTypes).toEqual(dataTypes);
  });

  it('includes running altitude with a non-default pace unit and a shared running profile', () => {
    const result = resolveEventChartRecommendations({
      profile: resolveEventChartSportProfile([ActivityTypes.Running, 'Road Running']),
      panels: [DataHeartRate.type, DataPaceMinutesPerMile.type, DataPower.type, DataAltitude.type].map(panel),
      globallyAllowedDataTypes: [DataHeartRate.type, DataPace.type, DataPower.type, DataAltitude.type],
    });

    expect(result.automaticDataTypes).toEqual([
      DataHeartRate.type, DataPaceMinutesPerMile.type, DataPower.type, DataAltitude.type,
    ]);
  });

  it('includes cycling altitude with a non-default speed unit', () => {
    const result = resolveEventChartRecommendations({
      profile: resolveEventChartSportProfile(['Road Cycling', 'Gravel Cycling']),
      panels: [DataHeartRate.type, DataPower.type, DataSpeedKnots.type, DataAltitude.type].map(panel),
      globallyAllowedDataTypes: [DataHeartRate.type, DataPower.type, DataSpeed.type, DataAltitude.type],
    });

    expect(result.automaticDataTypes).toEqual([
      DataHeartRate.type, DataPower.type, DataSpeedKnots.type, DataAltitude.type,
    ]);
  });

  it.each([
    [ActivityTypes.TrailRunning], [ActivityTypes.Orienteering], ['Vertical Running'],
    [ActivityTypes.TrailRunning, ActivityTypes.Orienteering, 'Vertical Running'],
  ])('keeps pace, power, altitude and recorded heart rate automatic for %j', (...activityTypes) => {
    const dataTypes = [DataPace.type, DataPower.type, DataAltitude.type, DataHeartRate.type, DataCadence.type];
    const result = resolveEventChartRecommendations({
      profile: resolveEventChartSportProfile(activityTypes),
      panels: [...dataTypes].reverse().map(panel),
      globallyAllowedDataTypes: dataTypes,
    });

    expect(result.automaticDataTypes).toEqual(dataTypes.slice(0, 4));
  });

  it('keeps the non-default pace unit when adding trail heart rate', () => {
    const dataTypes = [DataPaceMinutesPerMile.type, DataPower.type, DataAltitude.type, DataHeartRate.type];
    expect(resolveEventChartRecommendations({
      profile: resolveEventChartSportProfile([ActivityTypes.TrailRunning]),
      panels: dataTypes.map(panel),
      globallyAllowedDataTypes: [DataPace.type, DataPower.type, DataAltitude.type, DataHeartRate.type],
    }).automaticDataTypes).toEqual(dataTypes);
  });

  it.each(['missing', 'globally disabled', 'excluded'])(
    'keeps three trail charts without substituting another metric when heart rate is %s', availability => {
      const dataTypes = [DataPace.type, DataPower.type, DataAltitude.type, DataHeartRate.type, DataCadence.type, DataTemperature.type];
      expect(resolveEventChartRecommendations({
        profile: resolveEventChartSportProfile([ActivityTypes.TrailRunning]),
        panels: dataTypes.filter(type => availability !== 'missing' || type !== DataHeartRate.type).map(panel),
        globallyAllowedDataTypes: dataTypes.filter(type => availability !== 'globally disabled' || type !== DataHeartRate.type),
        automaticExcludedDataTypes: availability === 'excluded' ? [DataHeartRate.type] : [],
      }).automaticDataTypes).toEqual([DataPace.type, DataPower.type, DataAltitude.type]);
    },
  );

  it('does not duplicate trail heart rate or fill an extra slot when a primary metric is missing', () => {
    const dataTypes = [DataPace.type, DataAltitude.type, DataHeartRate.type, DataCadence.type];
    expect(resolveEventChartRecommendations({
      profile: resolveEventChartSportProfile([ActivityTypes.TrailRunning]),
      panels: dataTypes.map(panel),
      globallyAllowedDataTypes: dataTypes,
    }).automaticDataTypes).toEqual([DataPace.type, DataAltitude.type, DataHeartRate.type]);
  });

  it('keeps recorded heart rate automatic across the sport catalog except trajectory-first sky dives and transitions', () => {
    const dataTypes = [DataHeartRate.type, DataPace.type, DataPower.type, DataAltitude.type, DataSpeed.type,
      DataVerticalSpeed.type, DataCadence.type, DataStrokeRate.type, DataSwimPace.type, DataDepth.type,
      DataTemperature.type, DataSeaLevelPressure.type, DataEPOC.type];
    const withoutAutomaticHeartRate = ActivityTypesHelper.getActivityTypesAsUniqueArray().filter(activityType => (
      !resolveEventChartRecommendations({
        profile: resolveEventChartSportProfile([activityType]),
        panels: dataTypes.map(panel),
        globallyAllowedDataTypes: dataTypes,
      }).automaticDataTypes.includes(DataHeartRate.type)
    ));
    expect(withoutAutomaticHeartRate.sort()).toEqual([
      ActivityTypes.SkyDiving, ActivityTypes.Jumpmaster, ActivityTypes.Transition,
    ].sort());
  });

  it('already includes snowmobiling heart rate after speed and altitude', () => {
    const dataTypes = [DataSpeed.type, DataAltitude.type, DataHeartRate.type, DataTemperature.type];
    expect(resolveEventChartRecommendations({
      profile: resolveEventChartSportProfile([ActivityTypes.Snowmobiling]),
      panels: dataTypes.map(panel),
      globallyAllowedDataTypes: dataTypes,
    }).automaticDataTypes).toEqual(dataTypes.slice(0, 3));
  });

  it.each([ActivityTypes.SkyDiving, ActivityTypes.Jumpmaster])('keeps trajectory charts first and heart rate selectable for %s', activityType => {
    const dataTypes = [DataAltitude.type, DataVerticalSpeed.type, DataSpeed.type, DataHeartRate.type];
    const result = resolveEventChartRecommendations({
      profile: resolveEventChartSportProfile([activityType]),
      panels: dataTypes.map(panel),
      globallyAllowedDataTypes: dataTypes,
    });
    expect(result.automaticDataTypes).toEqual(dataTypes.slice(0, 3));
    expect(result.recommendedDataTypes).toEqual(dataTypes);
    expect(resolveEventChartRecommendations({
      profile: resolveEventChartSportProfile([activityType]),
      panels: dataTypes.filter(type => type !== DataVerticalSpeed.type).map(panel),
      globallyAllowedDataTypes: dataTypes,
    }).automaticDataTypes).toEqual([DataAltitude.type, DataSpeed.type, DataHeartRate.type]);
  });

  it.each(altitudeProfileCases.filter(({activityType}) => ['Running', 'Walking', 'Cycling'].includes(activityType))
    .flatMap(example => ['missing', 'globally disabled', 'excluded'].map(availability => ({...example, availability}))))(
    'preserves three $activityType defaults when altitude is $availability', ({activityType, primaryDataTypes, availability}) => {
    const dataTypes = [...primaryDataTypes, DataAltitude.type, DataCadence.type, DataTemperature.type];
    const result = resolveEventChartRecommendations({
      profile: resolveEventChartSportProfile([activityType]),
      panels: dataTypes.filter(type => availability !== 'missing' || type !== DataAltitude.type).map(panel),
      globallyAllowedDataTypes: dataTypes.filter(type => availability !== 'globally disabled' || type !== DataAltitude.type),
      automaticExcludedDataTypes: availability === 'excluded' ? [DataAltitude.type] : [],
    });

    expect(result.automaticDataTypes).toEqual(primaryDataTypes);
  });

  it.each([
    [ActivityTypes.TrailRunning, [DataPace.type, DataPower.type, DataAltitude.type, DataHeartRate.type]],
    [ActivityTypes.Hiking, [DataHeartRate.type, DataAltitude.type, DataSpeed.type]],
    [ActivityTypes.MountainBiking, [DataHeartRate.type, DataSpeed.type, DataAltitude.type]],
    [ActivityTypes.CrosscountrySkiing, [DataAltitude.type, DataHeartRate.type, DataPower.type]],
  ])('preserves existing altitude priorities for %s', (activityType, expected) => {
    const dataTypes = [DataHeartRate.type, DataPace.type, DataPower.type, DataAltitude.type, DataSpeed.type, DataCadence.type];
    const result = resolveEventChartRecommendations({
      profile: resolveEventChartSportProfile([activityType]),
      panels: dataTypes.map(panel),
      globallyAllowedDataTypes: dataTypes,
    });

    expect(result.automaticDataTypes).toEqual(expected);
  });

  it.each([
    'Track and Field', 'Inline Skating', 'Treadmill', 'Indoor Walking', 'Indoor Cycling',
    'Swimming', 'Open Water Swimming', 'Scuba Diving', 'Rowing', 'Strength Training', 'Soccer',
  ])('keeps altitude optional for %s', activityType => {
    const dataTypes = [DataHeartRate.type, DataPace.type, DataPower.type, DataAltitude.type, DataSpeed.type, DataTemperature.type];
    const result = resolveEventChartRecommendations({
      profile: resolveEventChartSportProfile([activityType]),
      panels: dataTypes.map(panel),
      globallyAllowedDataTypes: dataTypes,
    });

    expect(result.automaticDataTypes).not.toContain(DataAltitude.type);
    expect(result.otherDataTypes).toContain(DataAltitude.type);
  });

  it('selects available and globally allowed families without padding', () => {
    const profile = resolveEventChartSportProfile([ActivityTypes.Running]);
    const result = resolveEventChartRecommendations({
      profile,
      panels: [
        panel(DataHeartRate.type),
        panel(DataPace.type),
        panel(DataPower.type),
        panel(DataAltitude.type),
        panel(DataTemperature.type),
      ],
      globallyAllowedDataTypes: [DataHeartRate.type, DataPace.type, DataAltitude.type, DataTemperature.type],
    });

    expect(result.automaticDataTypes).toEqual([DataHeartRate.type, DataPace.type, DataAltitude.type]);
    expect(result.recommendedDataTypes).toEqual([
      DataHeartRate.type,
      DataPace.type,
      DataPower.type,
      DataAltitude.type,
      DataTemperature.type,
    ]);
    expect(result.otherDataTypes).toEqual([]);
  });

  it.each([
    [
      'Skating',
      ActivityTypes.InlineSkating,
      [DataHeartRate.type, DataSpeed.type, DataCadence.type, DataTemperature.type],
      [DataHeartRate.type, DataSpeed.type, DataCadence.type],
    ],
    [
      'Aerial Sports',
      ActivityTypes.Paragliding,
      [DataHeartRate.type, DataAltitude.type, DataVerticalSpeed.type, DataSpeed.type],
      [DataHeartRate.type, DataAltitude.type, DataVerticalSpeed.type],
    ],
    [
      'Motorized',
      ActivityTypes.Motorsports,
      [DataSpeed.type, DataAltitude.type, DataHeartRate.type, DataTemperature.type],
      [DataSpeed.type, DataAltitude.type, DataHeartRate.type],
    ],
  ])('selects the top three available automatic charts for %s', (label, activityType, dataTypes, automaticDataTypes) => {
    const result = resolveEventChartRecommendations({
      profile: resolveEventChartSportProfile([activityType]),
      panels: dataTypes.map(panel),
      globallyAllowedDataTypes: dataTypes,
    });

    expect(result.recommendedDataTypes.slice(0, 3)).toEqual(automaticDataTypes);
    expect(result.automaticDataTypes).toEqual(automaticDataTypes);
  });

  it('keeps globally disabled recommendations grouped but unchecked', () => {
    const profile = resolveEventChartSportProfile([ActivityTypes.IndoorCycling]);
    const result = resolveEventChartRecommendations({
      profile,
      panels: [panel(DataHeartRate.type), panel(DataPower.type), panel(DataCadence.type)],
      globallyAllowedDataTypes: [DataHeartRate.type],
    });

    expect(result.recommendedDataTypes).toEqual([DataHeartRate.type, DataPower.type, DataCadence.type]);
    expect(result.automaticDataTypes).toEqual([DataHeartRate.type]);
  });

  it('uses only one preferred Power panel for an automatic family slot', () => {
    const profile = resolveEventChartSportProfile([ActivityTypes.IndoorCycling]);
    const result = resolveEventChartRecommendations({
      profile,
      panels: [
        panel(DataHeartRate.type),
        panel(DataPowerLeft.type),
        panel(DataPowerRight.type),
        panel(DataAirPower.type),
        panel(DataPower.type),
        panel(DataCadence.type),
      ],
      globallyAllowedDataTypes: [
        DataHeartRate.type,
        DataPower.type,
        DataPowerLeft.type,
        DataPowerRight.type,
        DataAirPower.type,
        DataCadence.type,
      ],
    });

    expect(result.automaticDataTypes).toEqual([DataHeartRate.type, DataPower.type, DataCadence.type]);
    expect(result.recommendedDataTypes).toEqual([
      DataHeartRate.type,
      DataPower.type,
      DataAirPower.type,
      DataPowerRight.type,
      DataPowerLeft.type,
      DataCadence.type,
    ]);
  });

  it('resolves unit variants to stable selection keys and logical families', () => {
    expect(getEventChartSelectionKey(DataPaceMinutesPerMile.type)).toBe(DataPace.type);
    expect(getEventChartSelectionKey(DataSpeedKnots.type)).toBe(DataSpeed.type);
    expect(getEventChartSelectionKey(DataDepthFeet.type)).toBe(DataDepth.type);
    expect(getEventChartMetricFamily(DataPaceMinutesPerMile.type)).toBe('pace');
    expect(getEventChartMetricFamily(DataSpeedKnots.type)).toBe('speed');
    expect(getEventChartMetricFamily(DataStrokeRate.type)).toBe('stroke-rate');
  });

  it('applies automatic specialized-surface exclusions without removing recommendations', () => {
    const profile = resolveEventChartSportProfile([ActivityTypes.Snorkeling]);
    const result = resolveEventChartRecommendations({
      profile,
      panels: [
        panel(DataDepth.type),
        panel(DataTemperature.type),
        panel(DataHeartRate.type),
        panel(DataSpeed.type),
        panel(DataSwimPace.type),
      ],
      globallyAllowedDataTypes: [
        DataDepth.type,
        DataTemperature.type,
        DataHeartRate.type,
        DataSpeed.type,
        DataSwimPace.type,
      ],
      automaticExcludedDataTypes: [DataDepthFeet.type, DataTemperature.type, DataHeartRate.type],
    });

    expect(result.recommendedDataTypes).toEqual([
      DataDepth.type,
      DataTemperature.type,
      DataHeartRate.type,
      DataSpeed.type,
      DataSwimPace.type,
    ]);
    expect(result.automaticDataTypes).toEqual([DataSpeed.type, DataSwimPace.type]);
  });

  it('uses the non-depth Diving fallback when a generic dive has no depth panel', () => {
    const profile = resolveEventChartSportProfile([ActivityTypes.Diving]);
    const result = resolveEventChartRecommendations({
      profile,
      panels: [panel(DataHeartRate.type), panel(DataTemperature.type), panel(DataSpeed.type)],
      globallyAllowedDataTypes: [DataHeartRate.type, DataTemperature.type, DataSpeed.type],
    });

    expect(result.automaticDataTypes).toEqual([DataHeartRate.type, DataTemperature.type]);
    expect(result.otherDataTypes).toEqual([DataSpeed.type]);
  });
});

function panel(dataType: string) {
  return { dataType, displayName: dataType };
}
