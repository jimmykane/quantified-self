export type RouteWaypointCategory =
  | 'generic'
  | 'start'
  | 'finish'
  | 'summit'
  | 'valley'
  | 'water'
  | 'food'
  | 'danger'
  | 'left'
  | 'right'
  | 'sharp_left'
  | 'sharp_right'
  | 'slight_left'
  | 'slight_right'
  | 'straight'
  | 'first_aid'
  | 'climb'
  | 'sprint'
  | 'fork'
  | 'fork_left'
  | 'fork_right'
  | 'u_turn'
  | 'segment_start'
  | 'segment_end'
  | 'campsite'
  | 'aid_station'
  | 'rest_area'
  | 'general_distance'
  | 'service'
  | 'energy_gel'
  | 'sports_drink'
  | 'mile_marker'
  | 'checkpoint'
  | 'shelter'
  | 'meeting_spot'
  | 'overlook'
  | 'toilet'
  | 'shower'
  | 'gear'
  | 'route_feature'
  | 'obstacle'
  | 'crossing'
  | 'shaping_point';

export interface RouteWaypointPresentation {
  category: RouteWaypointCategory;
  icon: string;
  color: string;
  label: string;
  sourceLabel: string;
  isRouteShapingPoint: boolean;
  isRouteTurnInstruction: boolean;
  markerVariant: 'pin' | 'compact';
  turnGlyphPath?: string;
}

export interface RouteWaypointPresentationInput {
  name?: unknown;
  type?: unknown;
  symbol?: unknown;
  description?: unknown;
  comment?: unknown;
  desc?: unknown;
  cmt?: unknown;
}

interface RouteWaypointCategoryDefinition {
  icon: string;
  color: string;
  label: string;
}

interface RouteWaypointResolution {
  category: RouteWaypointCategory;
  sourceLabel: string;
}

const DEFAULT_SOURCE_LABEL = 'Waypoint';
const GENERIC_SOURCE_KEYS = new Set(['generic', 'point', 'route_point', 'waypoint', 'wpt']);

const COURSE_POINT_TYPE_BY_NUMBER: Record<number, RouteWaypointCategory> = {
  0: 'generic',
  1: 'summit',
  2: 'valley',
  3: 'water',
  4: 'food',
  5: 'danger',
  6: 'left',
  7: 'right',
  8: 'straight',
  9: 'first_aid',
  10: 'climb',
  11: 'climb',
  12: 'climb',
  13: 'climb',
  14: 'climb',
  15: 'sprint',
  16: 'fork_left',
  17: 'fork_right',
  18: 'fork',
  19: 'slight_left',
  20: 'sharp_left',
  21: 'slight_right',
  22: 'sharp_right',
  23: 'u_turn',
  24: 'segment_start',
  25: 'segment_end',
  26: 'shaping_point',
  27: 'campsite',
  28: 'aid_station',
  29: 'rest_area',
  30: 'general_distance',
  31: 'service',
  32: 'energy_gel',
  33: 'sports_drink',
  34: 'mile_marker',
  35: 'checkpoint',
  36: 'shelter',
  37: 'meeting_spot',
  38: 'overlook',
  39: 'toilet',
  40: 'shower',
  41: 'gear',
  42: 'danger',
  43: 'climb',
  44: 'route_feature',
  45: 'route_feature',
  46: 'obstacle',
  47: 'crossing',
};

const COURSE_POINT_TYPE_BY_KEY: Record<string, RouteWaypointCategory> = {
  generic: 'generic',
  begin: 'start',
  start: 'start',
  finish: 'finish',
  end: 'finish',
  summit: 'summit',
  valley: 'valley',
  water: 'water',
  food: 'food',
  danger: 'danger',
  left: 'left',
  left_turn: 'left',
  right: 'right',
  right_turn: 'right',
  straight: 'straight',
  straight_turn: 'straight',
  first_aid: 'first_aid',
  fourth_category: 'climb',
  third_category: 'climb',
  second_category: 'climb',
  first_category: 'climb',
  hors_category: 'climb',
  sprint: 'sprint',
  left_fork: 'fork_left',
  right_fork: 'fork_right',
  middle_fork: 'fork',
  left_at_fork_turn: 'fork_left',
  right_at_fork_turn: 'fork_right',
  slight_left: 'slight_left',
  slight_left_turn: 'slight_left',
  sharp_left: 'sharp_left',
  sharp_left_turn: 'sharp_left',
  slight_right: 'slight_right',
  slight_right_turn: 'slight_right',
  sharp_right: 'sharp_right',
  sharp_right_turn: 'sharp_right',
  u_turn: 'u_turn',
  uturn: 'u_turn',
  segment_start: 'segment_start',
  segment_end: 'segment_end',
  shaping_point: 'shaping_point',
  campsite: 'campsite',
  aid_station: 'aid_station',
  rest_area: 'rest_area',
  general_distance: 'general_distance',
  service: 'service',
  energy_gel: 'energy_gel',
  sports_drink: 'sports_drink',
  mile_marker: 'mile_marker',
  checkpoint: 'checkpoint',
  shelter: 'shelter',
  meeting_spot: 'meeting_spot',
  overlook: 'overlook',
  toilet: 'toilet',
  shower: 'shower',
  gear: 'gear',
  sharp_curve: 'danger',
  steep_incline: 'climb',
  tunnel: 'route_feature',
  bridge: 'route_feature',
  obstacle: 'obstacle',
  crossing: 'crossing',
};

const KEYWORD_CATEGORY_RULES: Array<{ keys: string[]; category: RouteWaypointCategory }> = [
  { keys: ['shaping_point'], category: 'shaping_point' },
  { keys: ['segment_start'], category: 'segment_start' },
  { keys: ['segment_end'], category: 'segment_end' },
  { keys: ['start', 'begin', 'trailhead', 'trail_head', 'departure'], category: 'start' },
  { keys: ['end', 'finish', 'destination', 'arrival'], category: 'finish' },
  { keys: ['first_aid', 'medical', 'hospital'], category: 'first_aid' },
  { keys: ['aid_station'], category: 'aid_station' },
  { keys: ['sports_drink', 'drink'], category: 'sports_drink' },
  { keys: ['water', 'spring', 'fountain'], category: 'water' },
  { keys: ['energy_gel', 'gel'], category: 'energy_gel' },
  { keys: ['food', 'restaurant', 'cafe', 'coffee', 'grocery', 'shop', 'store'], category: 'food' },
  { keys: ['toilet', 'restroom', 'bathroom', 'wc'], category: 'toilet' },
  { keys: ['shower'], category: 'shower' },
  { keys: ['campsite', 'campground', 'camp'], category: 'campsite' },
  { keys: ['shelter', 'hut'], category: 'shelter' },
  { keys: ['rest_area', 'rest_stop', 'lodging', 'hotel'], category: 'rest_area' },
  { keys: ['overlook', 'lookout', 'view', 'scenic'], category: 'overlook' },
  { keys: ['summit', 'peak'], category: 'summit' },
  { keys: ['valley'], category: 'valley' },
  { keys: ['climb', 'mountain', 'hill', 'steep', 'incline'], category: 'climb' },
  { keys: ['sprint'], category: 'sprint' },
  { keys: ['u_turn', 'uturn'], category: 'u_turn' },
  { keys: ['sharp_left'], category: 'sharp_left' },
  { keys: ['sharp_right'], category: 'sharp_right' },
  { keys: ['slight_left'], category: 'slight_left' },
  { keys: ['slight_right'], category: 'slight_right' },
  { keys: ['left_fork', 'left_at_fork'], category: 'fork_left' },
  { keys: ['right_fork', 'right_at_fork'], category: 'fork_right' },
  { keys: ['left'], category: 'left' },
  { keys: ['right'], category: 'right' },
  { keys: ['straight'], category: 'straight' },
  { keys: ['fork', 'junction', 'intersection', 'turn'], category: 'fork' },
  { keys: ['bridge', 'tunnel', 'crossing', 'underpass', 'overpass'], category: 'route_feature' },
  { keys: ['obstacle', 'roadblock', 'closed', 'blocked'], category: 'obstacle' },
  { keys: ['warning', 'danger', 'hazard', 'caution', 'accident', 'sharp_curve'], category: 'danger' },
  { keys: ['meeting_spot', 'meet'], category: 'meeting_spot' },
  { keys: ['mile_marker', 'km_marker', 'marker'], category: 'mile_marker' },
  { keys: ['checkpoint', 'control', 'flag'], category: 'checkpoint' },
  { keys: ['service', 'repair', 'fuel', 'gas'], category: 'service' },
  { keys: ['gear', 'equipment', 'tool'], category: 'gear' },
];

const CATEGORY_DEFINITIONS: Record<RouteWaypointCategory, RouteWaypointCategoryDefinition> = {
  generic: { icon: 'place', color: '#607d8b', label: 'Waypoint' },
  start: { icon: 'flag', color: '#2e7d32', label: 'Start' },
  finish: { icon: 'sports_score', color: '#c62828', label: 'Finish' },
  summit: { icon: 'terrain', color: '#8e24aa', label: 'Summit' },
  valley: { icon: 'landscape', color: '#6d4c41', label: 'Valley' },
  water: { icon: 'water_drop', color: '#0277bd', label: 'Water' },
  food: { icon: 'restaurant', color: '#ef6c00', label: 'Food' },
  danger: { icon: 'warning', color: '#d84315', label: 'Danger' },
  left: { icon: 'turn_left', color: '#3949ab', label: 'Left turn' },
  right: { icon: 'turn_right', color: '#3949ab', label: 'Right turn' },
  sharp_left: { icon: 'turn_sharp_left', color: '#3949ab', label: 'Sharp left turn' },
  sharp_right: { icon: 'turn_sharp_right', color: '#3949ab', label: 'Sharp right turn' },
  slight_left: { icon: 'turn_slight_left', color: '#3949ab', label: 'Slight left turn' },
  slight_right: { icon: 'turn_slight_right', color: '#3949ab', label: 'Slight right turn' },
  straight: { icon: 'straight', color: '#3949ab', label: 'Straight' },
  first_aid: { icon: 'medical_services', color: '#d81b60', label: 'First aid' },
  climb: { icon: 'terrain', color: '#8e24aa', label: 'Climb' },
  sprint: { icon: 'sprint', color: '#00897b', label: 'Sprint' },
  fork: { icon: 'alt_route', color: '#3949ab', label: 'Fork' },
  fork_left: { icon: 'turn_left', color: '#3949ab', label: 'Left at fork' },
  fork_right: { icon: 'turn_right', color: '#3949ab', label: 'Right at fork' },
  u_turn: { icon: 'u_turn_left', color: '#3949ab', label: 'U-turn' },
  segment_start: { icon: 'flag', color: '#2e7d32', label: 'Segment start' },
  segment_end: { icon: 'sports_score', color: '#c62828', label: 'Segment end' },
  campsite: { icon: 'camping', color: '#00695c', label: 'Campsite' },
  aid_station: { icon: 'medical_services', color: '#d81b60', label: 'Aid station' },
  rest_area: { icon: 'camping', color: '#00695c', label: 'Rest area' },
  general_distance: { icon: 'flag', color: '#5e35b1', label: 'Distance marker' },
  service: { icon: 'build', color: '#455a64', label: 'Service' },
  energy_gel: { icon: 'restaurant', color: '#ef6c00', label: 'Energy gel' },
  sports_drink: { icon: 'water_drop', color: '#0277bd', label: 'Sports drink' },
  mile_marker: { icon: 'flag', color: '#5e35b1', label: 'Mile marker' },
  checkpoint: { icon: 'flag', color: '#5e35b1', label: 'Checkpoint' },
  shelter: { icon: 'camping', color: '#00695c', label: 'Shelter' },
  meeting_spot: { icon: 'flag', color: '#5e35b1', label: 'Meeting spot' },
  overlook: { icon: 'visibility', color: '#8e24aa', label: 'Overlook' },
  toilet: { icon: 'wc', color: '#455a64', label: 'Toilet' },
  shower: { icon: 'shower', color: '#455a64', label: 'Shower' },
  gear: { icon: 'build', color: '#455a64', label: 'Gear' },
  route_feature: { icon: 'alt_route', color: '#3949ab', label: 'Route feature' },
  obstacle: { icon: 'warning', color: '#d84315', label: 'Obstacle' },
  crossing: { icon: 'alt_route', color: '#3949ab', label: 'Crossing' },
  shaping_point: { icon: 'route', color: '#78909c', label: 'Shaping point' },
};

const ROUTE_TURN_INSTRUCTION_CATEGORIES = new Set<RouteWaypointCategory>([
  'left',
  'right',
  'sharp_left',
  'sharp_right',
  'slight_left',
  'slight_right',
  'straight',
  'fork',
  'fork_left',
  'fork_right',
  'u_turn',
]);

const ROUTE_TURN_GLYPH_PATHS: Partial<Record<RouteWaypointCategory, string>> = {
  left: 'M16 12H7m3.5-3.5L7 12l3.5 3.5',
  right: 'M8 12h9m-3.5-3.5L17 12l-3.5 3.5',
  sharp_left: 'M16 12H7m3.5-3.5L7 12l3.5 3.5',
  sharp_right: 'M8 12h9m-3.5-3.5L17 12l-3.5 3.5',
  slight_left: 'M16 16 8 8m0 5V8h5',
  slight_right: 'M8 16l8-8m-5 0h5v5',
  straight: 'M12 17V7m-3.5 3.5L12 7l3.5 3.5',
  fork: 'M12 17V7m-3.5 3.5L12 7l3.5 3.5',
  fork_left: 'M16 16 8 8m0 5V8h5',
  fork_right: 'M8 16l8-8m-5 0h5v5',
  u_turn: 'M16 17v-5a4 4 0 0 0-4-4H7m3.5-3.5L7 8l3.5 3.5',
};

export function resolveRouteWaypointPresentation(
  waypoint: RouteWaypointPresentationInput | null | undefined,
): RouteWaypointPresentation {
  const typeLabel = toDisplayLabel(waypoint?.type);
  const symbolLabel = toDisplayLabel(waypoint?.symbol);
  const descriptionLabel = toDisplayLabel(waypoint?.description)
    || toDisplayLabel(waypoint?.desc)
    || toDisplayLabel(waypoint?.comment)
    || toDisplayLabel(waypoint?.cmt);
  const nameLabel = toDisplayLabel(waypoint?.name);

  const typeShapingPoint = resolveTypeValue(typeLabel);
  if (typeShapingPoint?.category === 'shaping_point') {
    return buildPresentation(typeShapingPoint);
  }

  if (typeShapingPoint && isNumericSource(typeLabel)) {
    return buildPresentation(typeShapingPoint);
  }

  const symbolResolution = resolveTextValue(symbolLabel);
  if (symbolResolution) {
    return buildPresentation(symbolResolution);
  }
  if (symbolLabel && !isGenericSourceLabel(symbolLabel)) {
    return buildPresentation({
      category: 'generic',
      sourceLabel: symbolLabel,
    });
  }

  const typeResolution = typeShapingPoint || resolveTextValue(typeLabel);
  if (typeResolution) {
    return buildPresentation(typeResolution);
  }
  if (typeLabel && !isGenericSourceLabel(typeLabel)) {
    return buildPresentation({
      category: 'generic',
      sourceLabel: typeLabel,
    });
  }

  const keywordResolution = resolveKeywordValue(nameLabel) || resolveKeywordValue(descriptionLabel);
  if (keywordResolution) {
    return buildPresentation(keywordResolution);
  }

  return buildPresentation({
    category: 'generic',
    sourceLabel: symbolLabel || typeLabel || nameLabel || descriptionLabel || DEFAULT_SOURCE_LABEL,
  });
}

export function isRouteWaypointShapingPoint(
  waypoint: RouteWaypointPresentationInput | null | undefined,
): boolean {
  return resolveRouteWaypointPresentation(waypoint).isRouteShapingPoint;
}

export function toRouteWaypointSourceLabel(value: unknown): string | null {
  return toDisplayLabel(value);
}

function buildPresentation(resolution: RouteWaypointResolution): RouteWaypointPresentation {
  const definition = CATEGORY_DEFINITIONS[resolution.category];
  const isRouteTurnInstruction = ROUTE_TURN_INSTRUCTION_CATEGORIES.has(resolution.category);
  return {
    category: resolution.category,
    icon: definition.icon,
    color: definition.color,
    label: definition.label,
    sourceLabel: resolution.sourceLabel || DEFAULT_SOURCE_LABEL,
    isRouteShapingPoint: resolution.category === 'shaping_point',
    isRouteTurnInstruction,
    markerVariant: isRouteTurnInstruction ? 'compact' : 'pin',
    turnGlyphPath: ROUTE_TURN_GLYPH_PATHS[resolution.category],
  };
}

function resolveTypeValue(sourceLabel: string | null): RouteWaypointResolution | null {
  if (!sourceLabel) {
    return null;
  }

  const numericValue = toNumericCoursePoint(sourceLabel);
  if (numericValue !== null) {
    const category = COURSE_POINT_TYPE_BY_NUMBER[numericValue];
    return category ? { category, sourceLabel } : null;
  }

  const category = COURSE_POINT_TYPE_BY_KEY[normalizeLookupKey(sourceLabel)];
  return category ? { category, sourceLabel } : null;
}

function resolveTextValue(sourceLabel: string | null): RouteWaypointResolution | null {
  if (!sourceLabel) {
    return null;
  }

  const category = COURSE_POINT_TYPE_BY_KEY[normalizeLookupKey(sourceLabel)];
  if (category) {
    return { category, sourceLabel };
  }

  return resolveKeywordValue(sourceLabel);
}

function resolveKeywordValue(sourceLabel: string | null): RouteWaypointResolution | null {
  if (!sourceLabel) {
    return null;
  }

  const lookupKey = normalizeLookupKey(sourceLabel);
  const rule = KEYWORD_CATEGORY_RULES.find(item => item.keys.some(key => hasLookupKeyPart(lookupKey, key)));
  return rule ? { category: rule.category, sourceLabel } : null;
}

function toDisplayLabel(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = `${value}`.trim();
  return text.length > 0 ? text : null;
}

function isNumericSource(value: string | null): boolean {
  return toNumericCoursePoint(value) !== null;
}

function isGenericSourceLabel(value: string): boolean {
  return GENERIC_SOURCE_KEYS.has(normalizeLookupKey(value));
}

function toNumericCoursePoint(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value.trim())) {
    return null;
  }

  const numericValue = Number(value);
  return Number.isInteger(numericValue) ? numericValue : null;
}

function normalizeLookupKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function hasLookupKeyPart(lookupKey: string, part: string): boolean {
  return lookupKey === part
    || lookupKey.startsWith(`${part}_`)
    || lookupKey.endsWith(`_${part}`)
    || lookupKey.includes(`_${part}_`);
}
