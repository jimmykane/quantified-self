import {
  ActivityTypes,
  ActivityTypesHelper,
  DataAirPower,
  DataAltitude,
  DataCadence,
  DataDepth,
  DataEPOC,
  DataGPSAltitude,
  DataHeartRate,
  DataPace,
  DataPower,
  DataPowerLeft,
  DataPowerRight,
  DataSeaLevelPressure,
  DataSpeed,
  DataStrydAltitude,
  DataStrydSpeed,
  DataSwimPace,
  DataTemperature,
  DataVerticalSpeed,
  DynamicDataLoader,
} from '@sports-alliance/sports-lib';

export type EventChartMetricFamily =
  | 'heart-rate'
  | 'depth'
  | 'pace'
  | 'swim-pace'
  | 'speed'
  | 'power'
  | 'altitude'
  | 'vertical-speed'
  | 'cadence'
  | 'temperature'
  | 'sea-level-pressure'
  | 'epoc'
  | 'stroke-rate'
  | 'swolf';

export type EventChartSportProfileSource =
  | 'exact'
  | 'alias'
  | 'shared-profile'
  | 'multisport'
  | 'fallback'
  | 'empty';

export interface EventChartSportProfileResolution {
  signature: string;
  canonicalActivityTypes: ActivityTypes[];
  profileID: EventChartSportProfileID;
  label: string;
  source: EventChartSportProfileSource;
  candidateFamilies: readonly EventChartMetricFamily[];
  usesGenericResetLabel: boolean;
}

export interface EventChartRecommendationPanel {
  dataType: string;
  displayName?: string;
}

export interface EventChartRecommendationResult {
  recommendedDataTypes: string[];
  otherDataTypes: string[];
  automaticDataTypes: string[];
}

interface EventChartSportProfile {
  id: EventChartSportProfileID;
  label: string;
  candidates: readonly EventChartMetricFamily[];
}

export const EVENT_CHART_AUTOMATIC_PANEL_LIMIT = 3;

const PROFILE_IDS = {
  Multisport: 'multisport',
  Running: 'running',
  Treadmill: 'treadmill',
  TrailRunning: 'trail-running',
  TrackAndField: 'track-and-field',
  Walking: 'walking',
  Hiking: 'hiking',
  SkiTouring: 'ski-touring',
  Paragliding: 'paragliding',
  Fishing: 'fishing',
  Hunting: 'hunting',
  Golf: 'golf',
  Climbing: 'climbing',
  IndoorClimbing: 'indoor-climbing',
  FloorClimbing: 'floor-climbing',
  SkyDiving: 'sky-diving',
  Cycling: 'cycling',
  IndoorCycling: 'indoor-cycling',
  MountainBiking: 'mountain-biking',
  Motor: 'motor',
  CrossCountrySkiing: 'cross-country-skiing',
  Snowshoeing: 'snowshoeing',
  AlpineSkiing: 'alpine-skiing',
  Snowmobiling: 'snowmobiling',
  IceSkating: 'ice-skating',
  PoolSwimming: 'pool-swimming',
  OpenWaterSwimming: 'open-water-swimming',
  Sailing: 'sailing',
  PaddledWater: 'paddled-water',
  IndoorRowing: 'indoor-rowing',
  WakeWater: 'wake-water',
  Fitness: 'fitness',
  TeamRacket: 'team-racket',
  Diving: 'diving',
  GenericDiving: 'generic-diving',
  Snorkeling: 'snorkeling',
  Mermaiding: 'mermaiding',
  Unknown: 'unknown',
  GeneralFallback: 'general-fallback',
  Empty: 'empty',
} as const;

export type EventChartSportProfileID = typeof PROFILE_IDS[keyof typeof PROFILE_IDS];

const PROFILES: Record<EventChartSportProfileID, EventChartSportProfile> = {
  [PROFILE_IDS.Multisport]: profile(PROFILE_IDS.Multisport, 'Multisport', ['heart-rate', 'speed', 'altitude', 'temperature', 'epoc']),
  [PROFILE_IDS.Running]: profile(PROFILE_IDS.Running, 'Running', ['heart-rate', 'pace', 'power', 'altitude', 'cadence', 'speed', 'epoc', 'vertical-speed', 'temperature']),
  [PROFILE_IDS.Treadmill]: profile(PROFILE_IDS.Treadmill, 'Treadmill', ['heart-rate', 'pace', 'power', 'cadence', 'speed', 'epoc', 'temperature']),
  [PROFILE_IDS.TrailRunning]: profile(PROFILE_IDS.TrailRunning, 'Trail Running', ['pace', 'power', 'altitude', 'heart-rate', 'vertical-speed', 'cadence', 'speed', 'epoc', 'temperature']),
  [PROFILE_IDS.TrackAndField]: profile(PROFILE_IDS.TrackAndField, 'Track and Field', ['heart-rate', 'pace', 'temperature']),
  [PROFILE_IDS.Walking]: profile(PROFILE_IDS.Walking, 'Walking', ['heart-rate', 'pace', 'power', 'cadence', 'altitude', 'vertical-speed', 'speed', 'temperature']),
  [PROFILE_IDS.Hiking]: profile(PROFILE_IDS.Hiking, 'Hiking', ['heart-rate', 'altitude', 'speed', 'vertical-speed', 'temperature', 'pace', 'power', 'cadence', 'epoc']),
  [PROFILE_IDS.SkiTouring]: profile(PROFILE_IDS.SkiTouring, 'Ski Touring', ['heart-rate', 'altitude', 'vertical-speed', 'speed', 'cadence', 'pace', 'temperature', 'epoc']),
  [PROFILE_IDS.Paragliding]: profile(PROFILE_IDS.Paragliding, 'Paragliding', ['heart-rate', 'altitude', 'vertical-speed', 'speed', 'temperature', 'epoc']),
  [PROFILE_IDS.Fishing]: profile(PROFILE_IDS.Fishing, 'Fishing', ['heart-rate', 'altitude', 'sea-level-pressure', 'speed', 'temperature']),
  [PROFILE_IDS.Hunting]: profile(PROFILE_IDS.Hunting, 'Hunting', ['pace', 'altitude', 'heart-rate', 'temperature', 'sea-level-pressure', 'speed']),
  [PROFILE_IDS.Golf]: profile(PROFILE_IDS.Golf, 'Golf', ['heart-rate', 'altitude', 'pace', 'temperature', 'speed']),
  [PROFILE_IDS.Climbing]: profile(PROFILE_IDS.Climbing, 'Climbing', ['heart-rate', 'altitude', 'vertical-speed', 'temperature']),
  [PROFILE_IDS.IndoorClimbing]: profile(PROFILE_IDS.IndoorClimbing, 'Indoor Climbing', ['heart-rate', 'temperature']),
  [PROFILE_IDS.FloorClimbing]: profile(PROFILE_IDS.FloorClimbing, 'Floor Climbing', ['heart-rate', 'cadence', 'vertical-speed']),
  [PROFILE_IDS.SkyDiving]: profile(PROFILE_IDS.SkyDiving, 'Sky Diving', ['altitude', 'vertical-speed', 'speed', 'heart-rate']),
  [PROFILE_IDS.Cycling]: profile(PROFILE_IDS.Cycling, 'Cycling', ['heart-rate', 'power', 'speed', 'altitude', 'vertical-speed', 'cadence', 'epoc', 'temperature']),
  [PROFILE_IDS.IndoorCycling]: profile(PROFILE_IDS.IndoorCycling, 'Indoor Cycling', ['heart-rate', 'power', 'cadence', 'speed', 'epoc', 'temperature']),
  [PROFILE_IDS.MountainBiking]: profile(PROFILE_IDS.MountainBiking, 'Mountain Biking', ['heart-rate', 'speed', 'altitude', 'vertical-speed', 'power', 'cadence', 'epoc', 'temperature']),
  [PROFILE_IDS.Motor]: profile(PROFILE_IDS.Motor, 'Motor sport', ['speed', 'altitude', 'heart-rate', 'temperature']),
  [PROFILE_IDS.CrossCountrySkiing]: profile(PROFILE_IDS.CrossCountrySkiing, 'Cross-country Skiing', ['altitude', 'heart-rate', 'power', 'speed', 'epoc', 'vertical-speed', 'cadence', 'pace', 'temperature']),
  [PROFILE_IDS.Snowshoeing]: profile(PROFILE_IDS.Snowshoeing, 'Snowshoeing', ['heart-rate', 'altitude', 'vertical-speed', 'speed', 'cadence', 'pace', 'temperature', 'epoc']),
  [PROFILE_IDS.AlpineSkiing]: profile(PROFILE_IDS.AlpineSkiing, 'Alpine Skiing', ['heart-rate', 'altitude', 'speed', 'vertical-speed', 'temperature']),
  [PROFILE_IDS.Snowmobiling]: profile(PROFILE_IDS.Snowmobiling, 'Snowmobiling', ['speed', 'altitude', 'heart-rate', 'temperature']),
  [PROFILE_IDS.IceSkating]: profile(PROFILE_IDS.IceSkating, 'Ice Skating', ['heart-rate', 'speed', 'cadence', 'sea-level-pressure', 'temperature']),
  [PROFILE_IDS.PoolSwimming]: profile(PROFILE_IDS.PoolSwimming, 'Pool Swimming', ['heart-rate', 'swim-pace', 'stroke-rate', 'swolf', 'temperature', 'epoc']),
  [PROFILE_IDS.OpenWaterSwimming]: profile(PROFILE_IDS.OpenWaterSwimming, 'Open Water Swimming', ['heart-rate', 'swim-pace', 'stroke-rate', 'speed', 'temperature', 'epoc']),
  [PROFILE_IDS.Sailing]: profile(PROFILE_IDS.Sailing, 'Sailing', ['heart-rate', 'speed', 'sea-level-pressure', 'temperature']),
  [PROFILE_IDS.PaddledWater]: profile(PROFILE_IDS.PaddledWater, 'Water sport', ['heart-rate', 'speed', 'cadence', 'sea-level-pressure', 'temperature']),
  [PROFILE_IDS.IndoorRowing]: profile(PROFILE_IDS.IndoorRowing, 'Indoor Rowing', ['heart-rate', 'speed', 'cadence', 'temperature']),
  [PROFILE_IDS.WakeWater]: profile(PROFILE_IDS.WakeWater, 'Water sport', ['heart-rate', 'speed', 'sea-level-pressure', 'temperature']),
  [PROFILE_IDS.Fitness]: profile(PROFILE_IDS.Fitness, 'Fitness', ['heart-rate', 'temperature']),
  [PROFILE_IDS.TeamRacket]: profile(PROFILE_IDS.TeamRacket, 'Team or racket sport', ['heart-rate', 'temperature']),
  [PROFILE_IDS.Diving]: profile(PROFILE_IDS.Diving, 'Diving', ['heart-rate', 'temperature']),
  [PROFILE_IDS.GenericDiving]: profile(PROFILE_IDS.GenericDiving, 'Diving', ['depth', 'temperature', 'heart-rate', 'speed', 'swim-pace']),
  [PROFILE_IDS.Snorkeling]: profile(PROFILE_IDS.Snorkeling, 'Snorkeling', ['depth', 'temperature', 'heart-rate', 'speed', 'swim-pace']),
  [PROFILE_IDS.Mermaiding]: profile(PROFILE_IDS.Mermaiding, 'Mermaiding', ['depth', 'temperature', 'heart-rate']),
  [PROFILE_IDS.Unknown]: profile(PROFILE_IDS.Unknown, 'Unknown Sport', ['heart-rate', 'altitude', 'pace', 'speed', 'epoc', 'temperature']),
  [PROFILE_IDS.GeneralFallback]: profile(PROFILE_IDS.GeneralFallback, 'Recommended', ['heart-rate', 'altitude', 'power', 'pace', 'speed', 'epoc', 'temperature']),
  [PROFILE_IDS.Empty]: profile(PROFILE_IDS.Empty, 'Transition', []),
};

const ACTIVITY_TYPE_PROFILE = new Map<ActivityTypes, EventChartSportProfileID>();
const ACTIVITY_TYPE_SOURCE = new Map<ActivityTypes, Exclude<EventChartSportProfileSource, 'shared-profile' | 'multisport'>>();

register(PROFILE_IDS.Multisport, ['Triathlon', 'Duathlon', 'Swimrun', 'Aquathlon', 'Multisport', 'Adventure Racing']);
register(PROFILE_IDS.Running, ['Running']);
register(PROFILE_IDS.Treadmill, ['Treadmill', 'Indoor Running', 'Virtual Running'], 'alias');
register(PROFILE_IDS.TrailRunning, ['Trail Running', 'Orienteering']);
register(PROFILE_IDS.TrackAndField, ['Track and Field']);
register(PROFILE_IDS.Walking, ['Walking', 'Nordic Walking']);
register(PROFILE_IDS.Hiking, ['Hiking', 'Trekking', 'Horseback Riding']);
register(PROFILE_IDS.SkiTouring, ['Ski Touring', 'Mountaineering', 'Backcountry Skiing']);
register(PROFILE_IDS.Paragliding, ['Paragliding', 'Hang Gliding', 'Flying']);
register(PROFILE_IDS.Fishing, ['Fishing']);
register(PROFILE_IDS.Hunting, ['Hunting']);
register(PROFILE_IDS.Golf, ['Golf', 'Frisbee']);
register(PROFILE_IDS.Climbing, ['Climbing', 'Rock Climbing', 'Canyoning', 'Via Ferrata']);
register(PROFILE_IDS.IndoorClimbing, ['Indoor Climbing', 'Bouldering']);
register(PROFILE_IDS.FloorClimbing, ['Floor Climbing', 'Stair Stepper']);
register(PROFILE_IDS.SkyDiving, ['Sky Diving', 'Jumpmaster']);
register(PROFILE_IDS.Cycling, ['Cycling', 'E-Biking', 'Hand Cycle', 'Velomobile', 'Wheel Chair']);
register(PROFILE_IDS.IndoorCycling, ['Indoor Cycling', 'Virtual Cycling']);
register(PROFILE_IDS.MountainBiking, ['Mountain Biking', 'Enduro MTB', 'Downhill Cycling']);
register(PROFILE_IDS.Motor, ['Motorcycling', 'Motorsports', 'Driving']);
register(PROFILE_IDS.CrossCountrySkiing, ['Crosscountry Skiing', 'Roller Skiing', 'Nordic Skiing']);
register(PROFILE_IDS.Snowshoeing, ['Snowshoeing']);
register(PROFILE_IDS.AlpineSkiing, ['Alpine Skiing', 'Snowboarding', 'Telemark Skiing']);
register(PROFILE_IDS.Snowmobiling, ['Snowmobiling']);
register(PROFILE_IDS.IceSkating, ['Ice Skating', 'Skating', 'Inline Skating']);
register(PROFILE_IDS.PoolSwimming, ['Swimming']);
register(PROFILE_IDS.OpenWaterSwimming, ['Open Water Swimming']);
register(PROFILE_IDS.Sailing, ['Sailing', 'Boating']);
register(PROFILE_IDS.PaddledWater, ['Stand Up Paddling', 'Surfing', 'Canoeing', 'Kitesurfing', 'Windsurfing', 'Rowing', 'Kayaking', 'Paddling', 'Rafting']);
register(PROFILE_IDS.IndoorRowing, ['Indoor Rowing', 'Crosstrainer', 'Elliptical Trainer']);
register(PROFILE_IDS.WakeWater, ['Wakeboarding', 'Water Skiing']);
register(PROFILE_IDS.Fitness, [
  'Aerobics', 'Yoga', 'Circuit Training', 'Stretching', 'Gym', 'Cheerleading', 'Combat', 'Boxing',
  'Bowling', 'Dancing', 'Gymnastics', 'Kettlebell', 'Crossfit', 'Strength Training', 'Weight Training',
  'Workout', 'Training', 'Indoor Training', 'Fitness Equipment', 'HIIT', 'Cardio Training', 'Pilates',
  'Flexibility Training', 'Tactical',
]);
register(PROFILE_IDS.TeamRacket, [
  'Softball', 'Floorball', 'Handball', 'Basketball', 'Soccer', 'Ice Hockey', 'Volleyball', 'American Football',
  'Baseball', 'Rugby', 'Football', 'Tennis', 'Badminton', 'Table Tennis', 'Racquet Ball', 'Squash', 'Cricket', 'Match',
]);
register(PROFILE_IDS.Diving, ['Scuba Diving', 'Free Diving']);
register(PROFILE_IDS.GenericDiving, ['Diving']);
register(PROFILE_IDS.Snorkeling, ['Snorkeling']);
register(PROFILE_IDS.Mermaiding, ['Mermaiding']);
register(PROFILE_IDS.Unknown, ['Unknown Sport', 'Other', 'Generic']);
register(PROFILE_IDS.GeneralFallback, ['Route'], 'fallback');
register(PROFILE_IDS.Empty, ['Transition'], 'empty');

const FAMILY_PRIMARY_TYPES: Record<Exclude<EventChartMetricFamily, 'stroke-rate' | 'swolf'>, string[]> = {
  'heart-rate': [DataHeartRate.type],
  depth: [DataDepth.type],
  pace: [DataPace.type],
  'swim-pace': [DataSwimPace.type],
  speed: [DataSpeed.type, DataStrydSpeed.type],
  power: [DataPower.type, DataAirPower.type, DataPowerRight.type, DataPowerLeft.type],
  altitude: [DataAltitude.type, DataGPSAltitude.type, DataStrydAltitude.type],
  'vertical-speed': [DataVerticalSpeed.type],
  cadence: [DataCadence.type],
  temperature: [DataTemperature.type],
  'sea-level-pressure': [DataSeaLevelPressure.type],
  epoc: [DataEPOC.type],
};

const DATA_TYPE_FAMILY = new Map<string, EventChartMetricFamily>();
Object.entries(FAMILY_PRIMARY_TYPES).forEach(([family, dataTypes]) => {
  dataTypes.forEach((dataType) => DATA_TYPE_FAMILY.set(dataType, family as EventChartMetricFamily));
});

export function resolveEventChartSportProfile(activityTypes: readonly unknown[]): EventChartSportProfileResolution {
  const canonicalActivityTypes = [...new Set((activityTypes || [])
    .map((activityType) => ActivityTypesHelper.resolveActivityType(activityType) || ActivityTypes.unknown))]
    .sort((left, right) => left.localeCompare(right));
  const normalizedTypes = canonicalActivityTypes.length > 0
    ? canonicalActivityTypes
    : [ActivityTypes.unknown];
  const registeredProfileIDs = normalizedTypes.map((activityType) => (
    ACTIVITY_TYPE_PROFILE.get(activityType) || PROFILE_IDS.GeneralFallback
  ));
  const uniqueProfileIDs = [...new Set(registeredProfileIDs)];
  const isMixedProfile = uniqueProfileIDs.length > 1;
  const profileID = isMixedProfile ? PROFILE_IDS.Multisport : uniqueProfileIDs[0];
  const profileDefinition = PROFILES[profileID];
  const singleActivityType = normalizedTypes.length === 1 ? normalizedTypes[0] : null;
  const source = resolveProfileSource(singleActivityType, profileID, isMixedProfile, normalizedTypes.length);

  return {
    signature: buildEventChartActivityTypeSignature(normalizedTypes),
    canonicalActivityTypes: normalizedTypes,
    profileID,
    label: resolveProfileLabel(singleActivityType, profileDefinition, isMixedProfile),
    source,
    candidateFamilies: profileDefinition.candidates,
    usesGenericResetLabel: profileID === PROFILE_IDS.Multisport || isMixedProfile,
  };
}

export function resolveEventChartRecommendations(input: {
  profile: EventChartSportProfileResolution;
  panels: readonly EventChartRecommendationPanel[];
  globallyAllowedDataTypes: readonly string[];
  automaticExcludedDataTypes?: readonly string[];
}): EventChartRecommendationResult {
  const panels = Array.isArray(input.panels) ? input.panels.filter((panel) => !!panel?.dataType) : [];
  const candidateFamilies = resolveAvailableCandidateFamilies(input.profile, panels);
  const allowedSelectionKeys = new Set((input.globallyAllowedDataTypes || []).map(getEventChartSelectionKey));
  const excludedFamilies = new Set((input.automaticExcludedDataTypes || [])
    .map(getEventChartMetricFamily)
    .filter((family): family is EventChartMetricFamily => !!family));
  const recommendedDataTypes: string[] = [];
  const automaticDataTypes: string[] = [];

  candidateFamilies.forEach((family) => {
    const familyPanels = panels
      .filter((panel) => getEventChartMetricFamily(panel.dataType) === family)
      .sort((left, right) => compareFamilyPanels(family, left.dataType, right.dataType));
    familyPanels.forEach((panel) => appendUnique(recommendedDataTypes, panel.dataType));

    if (automaticDataTypes.length >= EVENT_CHART_AUTOMATIC_PANEL_LIMIT || excludedFamilies.has(family)) {
      return;
    }

    const automaticPanel = familyPanels.find((panel) => allowedSelectionKeys.has(getEventChartSelectionKey(panel.dataType)));
    if (automaticPanel) {
      automaticDataTypes.push(automaticPanel.dataType);
    }
  });

  const recommendedSet = new Set(recommendedDataTypes);
  return {
    recommendedDataTypes,
    otherDataTypes: panels.map((panel) => panel.dataType).filter((dataType) => !recommendedSet.has(dataType)),
    automaticDataTypes,
  };
}

export function getEventChartMetricFamily(dataType: string | null | undefined): EventChartMetricFamily | null {
  const selectionKey = getEventChartSelectionKey(dataType);
  return DATA_TYPE_FAMILY.get(selectionKey) || DATA_TYPE_FAMILY.get(`${dataType || ''}`) || null;
}

export function getEventChartSelectionKey(dataType: string | null | undefined): string {
  const normalizedType = `${dataType || ''}`.trim();
  if (!normalizedType) {
    return '';
  }

  const unitGroups = (DynamicDataLoader as unknown as {
    dataTypeUnitGroups?: Record<string, Record<string, unknown>>;
  }).dataTypeUnitGroups || {};
  const unitBaseType = Object.entries(unitGroups)
    .find(([baseType, variants]) => baseType === normalizedType || Object.prototype.hasOwnProperty.call(variants, normalizedType))
    ?.[0];
  return unitBaseType || normalizedType;
}

export function getRegisteredEventChartActivityTypes(): ActivityTypes[] {
  return [...ACTIVITY_TYPE_PROFILE.keys()].sort((left, right) => left.localeCompare(right));
}

export function getUnclassifiedEventChartActivityTypes(): string[] {
  const registeredTypes = new Set(getRegisteredEventChartActivityTypes());
  return ActivityTypesHelper.getActivityTypesAsUniqueArray()
    .filter((activityType) => !registeredTypes.has(activityType as ActivityTypes));
}

function profile(
  id: EventChartSportProfileID,
  label: string,
  candidates: readonly EventChartMetricFamily[]
): EventChartSportProfile {
  return { id, label, candidates };
}

function register(
  profileID: EventChartSportProfileID,
  activityTypes: readonly string[],
  source: 'exact' | 'alias' | 'fallback' | 'empty' = 'exact'
): void {
  activityTypes.forEach((activityType) => {
    const canonicalType = ActivityTypesHelper.resolveActivityType(activityType);
    if (!canonicalType) {
      return;
    }
    ACTIVITY_TYPE_PROFILE.set(canonicalType, profileID);
    ACTIVITY_TYPE_SOURCE.set(canonicalType, source);
  });
}

function buildEventChartActivityTypeSignature(activityTypes: readonly ActivityTypes[]): string {
  return `types-v1:${activityTypes.map((activityType) => encodeURIComponent(activityType)).join('+')}`;
}

function resolveProfileSource(
  singleActivityType: ActivityTypes | null,
  profileID: EventChartSportProfileID,
  isMixedProfile: boolean,
  activityTypeCount: number
): EventChartSportProfileSource {
  if (isMixedProfile) {
    return 'multisport';
  }
  if (activityTypeCount > 1) {
    return 'shared-profile';
  }
  if (profileID === PROFILE_IDS.Empty) {
    return 'empty';
  }
  return singleActivityType ? ACTIVITY_TYPE_SOURCE.get(singleActivityType) || 'fallback' : 'fallback';
}

function resolveProfileLabel(
  singleActivityType: ActivityTypes | null,
  profileDefinition: EventChartSportProfile,
  isMixedProfile: boolean
): string {
  if (isMixedProfile) {
    return PROFILES[PROFILE_IDS.Multisport].label;
  }
  if (singleActivityType === ActivityTypes.Swimming) {
    return PROFILES[PROFILE_IDS.PoolSwimming].label;
  }
  return singleActivityType || profileDefinition.label;
}

function resolveAvailableCandidateFamilies(
  profile: EventChartSportProfileResolution,
  panels: readonly EventChartRecommendationPanel[]
): readonly EventChartMetricFamily[] {
  if (profile.profileID !== PROFILE_IDS.GenericDiving) {
    return profile.candidateFamilies;
  }
  const hasDepth = panels.some((panel) => getEventChartMetricFamily(panel.dataType) === 'depth');
  return hasDepth ? PROFILES[PROFILE_IDS.GenericDiving].candidates : PROFILES[PROFILE_IDS.Diving].candidates;
}

function compareFamilyPanels(family: EventChartMetricFamily, leftDataType: string, rightDataType: string): number {
  const preferredTypes = family === 'stroke-rate' || family === 'swolf'
    ? []
    : FAMILY_PRIMARY_TYPES[family];
  const leftSelectionKey = getEventChartSelectionKey(leftDataType);
  const rightSelectionKey = getEventChartSelectionKey(rightDataType);
  const leftIndex = preferredTypes.indexOf(leftSelectionKey);
  const rightIndex = preferredTypes.indexOf(rightSelectionKey);

  if (leftIndex !== rightIndex) {
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  }
  return leftDataType.localeCompare(rightDataType);
}

function appendUnique(values: string[], value: string): void {
  if (value && !values.includes(value)) {
    values.push(value);
  }
}
