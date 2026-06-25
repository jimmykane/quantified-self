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
  | 'straight'
  | 'first_aid'
  | 'climb'
  | 'sprint'
  | 'fork'
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
  16: 'fork',
  17: 'fork',
  18: 'fork',
  19: 'left',
  20: 'left',
  21: 'right',
  22: 'right',
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
  summit: 'summit',
  valley: 'valley',
  water: 'water',
  food: 'food',
  danger: 'danger',
  left: 'left',
  right: 'right',
  straight: 'straight',
  first_aid: 'first_aid',
  fourth_category: 'climb',
  third_category: 'climb',
  second_category: 'climb',
  first_category: 'climb',
  hors_category: 'climb',
  sprint: 'sprint',
  left_fork: 'fork',
  right_fork: 'fork',
  middle_fork: 'fork',
  slight_left: 'left',
  sharp_left: 'left',
  slight_right: 'right',
  sharp_right: 'right',
  u_turn: 'u_turn',
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

const KEYWORD_CATEGORY_RULES: Array<{ pattern: RegExp; category: RouteWaypointCategory }> = [
  { pattern: /\b(shaping[_\s-]*point)\b/i, category: 'shaping_point' },
  { pattern: /\b(segment[_\s-]*start)\b/i, category: 'segment_start' },
  { pattern: /\b(segment[_\s-]*end)\b/i, category: 'segment_end' },
  { pattern: /\b(start|begin|trailhead|trail[_\s-]*head|departure)\b/i, category: 'start' },
  { pattern: /\b(end|finish|destination|arrival)\b/i, category: 'finish' },
  { pattern: /\b(first[_\s-]*aid|medical|hospital)\b/i, category: 'first_aid' },
  { pattern: /\b(aid[_\s-]*station)\b/i, category: 'aid_station' },
  { pattern: /\b(sports[_\s-]*drink|drink)\b/i, category: 'sports_drink' },
  { pattern: /\b(water|spring|fountain)\b/i, category: 'water' },
  { pattern: /\b(energy[_\s-]*gel|gel)\b/i, category: 'energy_gel' },
  { pattern: /\b(food|restaurant|cafe|coffee|grocery|shop|store)\b/i, category: 'food' },
  { pattern: /\b(toilet|restroom|bathroom|wc)\b/i, category: 'toilet' },
  { pattern: /\b(shower)\b/i, category: 'shower' },
  { pattern: /\b(campsite|campground|camp)\b/i, category: 'campsite' },
  { pattern: /\b(shelter|hut)\b/i, category: 'shelter' },
  { pattern: /\b(rest[_\s-]*area|rest[_\s-]*stop|lodging|hotel)\b/i, category: 'rest_area' },
  { pattern: /\b(overlook|lookout|view|scenic)\b/i, category: 'overlook' },
  { pattern: /\b(summit|peak)\b/i, category: 'summit' },
  { pattern: /\b(valley)\b/i, category: 'valley' },
  { pattern: /\b(climb|mountain|hill|steep|incline)\b/i, category: 'climb' },
  { pattern: /\b(sprint)\b/i, category: 'sprint' },
  { pattern: /\b(u[_\s-]*turn|uturn)\b/i, category: 'u_turn' },
  { pattern: /\b(left|slight[_\s-]*left|sharp[_\s-]*left)\b/i, category: 'left' },
  { pattern: /\b(right|slight[_\s-]*right|sharp[_\s-]*right)\b/i, category: 'right' },
  { pattern: /\b(straight)\b/i, category: 'straight' },
  { pattern: /\b(fork|junction|intersection|turn)\b/i, category: 'fork' },
  { pattern: /\b(bridge|tunnel|crossing|underpass|overpass)\b/i, category: 'route_feature' },
  { pattern: /\b(obstacle|roadblock|closed|blocked)\b/i, category: 'obstacle' },
  { pattern: /\b(warning|danger|hazard|caution|accident|sharp[_\s-]*curve)\b/i, category: 'danger' },
  { pattern: /\b(meeting[_\s-]*spot|meet)\b/i, category: 'meeting_spot' },
  { pattern: /\b(mile[_\s-]*marker|km[_\s-]*marker|marker)\b/i, category: 'mile_marker' },
  { pattern: /\b(checkpoint|control|flag)\b/i, category: 'checkpoint' },
  { pattern: /\b(service|repair|fuel|gas)\b/i, category: 'service' },
  { pattern: /\b(gear|equipment|tool)\b/i, category: 'gear' },
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
  straight: { icon: 'straight', color: '#3949ab', label: 'Straight' },
  first_aid: { icon: 'medical_services', color: '#d81b60', label: 'First aid' },
  climb: { icon: 'terrain', color: '#8e24aa', label: 'Climb' },
  sprint: { icon: 'sprint', color: '#00897b', label: 'Sprint' },
  fork: { icon: 'alt_route', color: '#3949ab', label: 'Fork' },
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
  return {
    category: resolution.category,
    icon: definition.icon,
    color: definition.color,
    label: definition.label,
    sourceLabel: resolution.sourceLabel || DEFAULT_SOURCE_LABEL,
    isRouteShapingPoint: resolution.category === 'shaping_point',
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

  const rule = KEYWORD_CATEGORY_RULES.find(item => item.pattern.test(sourceLabel));
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
