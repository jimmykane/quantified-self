import {
  ActivityTypeGroups,
  ActivityTypes,
  ActivityTypesHelper,
  type ActivityTypeGroup,
} from '@sports-alliance/sports-lib';
import { isActivityTypeInFilterFamily, isRunningFamilyActivityType } from '@shared/activity-type-family';
import { AppActivityTypeGroupColors } from '../services/color/app.activity-type-group.colors';
import { AppActivityTypeGroupIcons } from '../services/color/app.activity-type-group.icons';

const ACTIVITY_TYPE_ICON_OVERRIDES: Readonly<Record<string, string>> = {
  virtualcycling: 'computer',
  virtualride: 'computer',
  virtualrunning: 'computer',
  virtualrun: 'computer',
  treadmill: 'sprint',
  indoorrunning: 'sprint',
  ebiking: 'electric_bike',
  ebike: 'electric_bike',
  openwaterswimming: 'waves',
  kayaking: 'kayaking',
  whitewaterkayaking: 'kayaking',
  canoeing: 'kayaking',
  paddling: 'kayaking',
  standuppaddling: 'kayaking',
  sup: 'kayaking',
  rowing: 'rowing',
  indoorrowing: 'rowing',
  virtualrowing: 'rowing',
  sailing: 'sailing',
  sailracing: 'sailing',
  surfing: 'surfing',
  wakeboarding: 'surfing',
  kitesurfing: 'kitesurfing',
  snowboarding: 'snowboarding',
  iceskating: 'ice_skating',
  skateboarding: 'skateboarding',
  snowshoeing: 'snowshoeing',
  walking: 'directions_walk',
  nordicwalking: 'nordic_walking',
  trekking: 'hiking',
  yoga: 'self_improvement',
  pilates: 'self_improvement',
  flexibilitytraining: 'self_improvement',
  stretching: 'self_improvement',
  meditation: 'self_improvement',
  breathwork: 'self_improvement',
  emountainbiking: 'electric_bike',
  eenduromtb: 'electric_bike',
  weighttraining: 'fitness_center',
  strengthtraining: 'exercise',
  kettlebell: 'weight',
  fitnessboxing: 'sports_mma',
  basketball: 'sports_basketball',
  football: 'sports_soccer',
  soccer: 'sports_soccer',
  americanfootball: 'sports_football',
  rugby: 'sports_rugby',
  tennis: 'sports_tennis',
  golf: 'sports_golf',
  cricket: 'sports_cricket',
  baseball: 'sports_baseball',
  softball: 'sports_baseball',
  handball: 'sports_handball',
  icehockey: 'sports_hockey',
  volleyball: 'sports_volleyball',
  videogaming: 'sports_esports',
};

export function resolvePrimaryActivityType(activityType: unknown): string {
  if (activityType === null || activityType === undefined) {
    return '';
  }

  if (Array.isArray(activityType)) {
    return String(activityType[0] ?? '').trim();
  }

  if (typeof activityType === 'number') {
    return ActivityTypes[activityType] || '';
  }

  if (typeof activityType === 'string') {
    return activityType.split(',')[0].trim();
  }

  if (typeof activityType === 'object') {
    const withType = activityType as { type?: unknown };
    if (withType.type !== undefined && withType.type !== null) {
      return String(withType.type).trim();
    }
  }

  return String(activityType).trim();
}

export function resolveActivityTypeMaterialIcon(activityType: unknown): string {
  const activity = resolvePrimaryActivityType(activityType);
  if (!activity) {
    return 'category';
  }

  const normalizedActivityType = activity
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '');
  const overrideIcon = ACTIVITY_TYPE_ICON_OVERRIDES[normalizedActivityType];
  if (overrideIcon) {
    return overrideIcon;
  }

  if (isRunningFamilyActivityType(activity)) return 'directions_run';
  if (['indoorwalking', 'speedwalking'].includes(normalizedActivityType)) return 'directions_walk';
  if (normalizedActivityType === 'mountainbikeorienteering') return 'terrain';
  if (isActivityTypeInFilterFamily(activity, 'cycling')
    && ActivityTypesHelper.getActivityGroupForActivityType(ActivityTypesHelper.resolveActivityType(activity) || ActivityTypes.Other) !== ActivityTypeGroups.MountainBikingGroup) {
    return 'directions_bike';
  }

  const activityTypeEnum = ActivityTypesHelper.resolveActivityType(activity) || ActivityTypes.Other;
  const group = ActivityTypesHelper.getActivityGroupForActivityType(activityTypeEnum);
  return AppActivityTypeGroupIcons[group] || 'category';
}

export function resolveActivityTypeIconColor(activityType: unknown): string {
  const activity = resolvePrimaryActivityType(activityType);
  if (!activity) {
    return '';
  }

  const activityTypeEnum = ActivityTypesHelper.resolveActivityType(activity) || ActivityTypes.Other;
  const group: ActivityTypeGroup = activityTypeEnum === ActivityTypes.Trekking
    ? ActivityTypeGroups.OutdoorAdventuresGroup
    : ActivityTypesHelper.getActivityGroupForActivityType(activityTypeEnum);
  return AppActivityTypeGroupColors[group] || '';
}
