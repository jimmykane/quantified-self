import type { ActivityTypeGroup, ActivityTypes } from '@sports-alliance/sports-lib';
import { ActivityTypeGroups } from '@sports-alliance/sports-lib';
import { getActivityTypeGroupCatalog } from '@shared/activity-type-group.metadata';
import { AppActivityTypeGroupColors } from '../../services/color/app.activity-type-group.colors';
import { AppActivityTypeGroupGradients } from '../../services/color/app.activity-type-group.gradients';
import { AppActivityTypeGroupIcons } from '../../services/color/app.activity-type-group.icons';
import { SUPPORTED_ACTIVITIES_PATH } from './supported-activities-page.paths';

export { SUPPORTED_ACTIVITIES_PATH } from './supported-activities-page.paths';

export interface SupportedActivityFamily {
  id: ActivityTypeGroup;
  label: string;
  activityTypes: readonly ActivityTypes[];
  icon: string;
  color: string;
  gradient: string;
  fallback: boolean;
}

export interface SupportedActivityContentItem {
  icon: string;
  title: string;
  copy: string;
}

export interface SupportedActivitiesRouteData {
  title: string;
  preload: boolean;
  animation: string;
  description: string;
  jsonLd: Record<string, unknown>;
}

export const SUPPORTED_ACTIVITIES_URL = `https://quantified-self.io/${SUPPORTED_ACTIVITIES_PATH}`;

export const SUPPORTED_ACTIVITY_FAMILIES: readonly SupportedActivityFamily[] = getActivityTypeGroupCatalog().map((entry) => {
  const gradient = AppActivityTypeGroupGradients[entry.id];

  return {
    id: entry.id,
    label: entry.label,
    activityTypes: entry.activityTypes,
    icon: AppActivityTypeGroupIcons[entry.id],
    color: AppActivityTypeGroupColors[entry.id],
    gradient: `linear-gradient(135deg, ${gradient.start}, ${gradient.end})`,
    fallback: entry.id === ActivityTypeGroups.UnspecifiedGroup,
  };
});

export const SUPPORTED_ACTIVITY_TYPE_COUNT = SUPPORTED_ACTIVITY_FAMILIES
  .reduce((count, family) => count + family.activityTypes.length, 0);

export const SUPPORTED_ACTIVITY_SUPPORT_LEVELS: readonly SupportedActivityContentItem[] = [
  {
    icon: 'category',
    title: 'Recognized activity type',
    copy: 'The catalog lists the canonical activity types Quantified Self recognizes and the family used to organize them across the app.',
  },
  {
    icon: 'query_stats',
    title: 'Recorded metrics first',
    copy: 'Distance, route, terrain, sensors, laps, lengths, jumps, charts, and sport-specific records appear only when an imported source provides compatible data.',
  },
  {
    icon: 'stacked_line_chart',
    title: 'Type-aware Event Details',
    copy: 'An individual activity uses its exact type to recommend compatible charts. A family does not promise the same chart behavior for every member.',
  },
  {
    icon: 'sync',
    title: 'Source and provider dependent',
    copy: 'Connected services, manual files, device models, and recording settings can all affect which fields arrive with an activity.',
  },
];

export const SUPPORTED_ACTIVITY_SPECIALIZED_SURFACES: readonly SupportedActivityContentItem[] = [
  {
    icon: 'table_rows',
    title: 'Laps and swim lengths',
    copy: 'Event Details shows Laps when selected activities contain lap data. Swimming activities can show Swim Lengths when their source includes per-length pool data.',
  },
  {
    icon: 'landscape',
    title: 'Recorded jump details',
    copy: 'Event Details shows Jumps when selected activities contain jump events. The visible columns follow the values actually recorded.',
  },
  {
    icon: 'stacked_line_chart',
    title: 'Charts from compatible samples',
    copy: 'Charts and overlays need compatible source time series. Recommendations prioritize relevant recorded panels rather than adding a missing metric.',
  },
];

export const SUPPORTED_ACTIVITY_PRESENTATION_NOTES: readonly SupportedActivityContentItem[] = [
  {
    icon: 'sailing',
    title: 'Families organize; types recommend',
    copy: 'Boating is organized in Motorized, while an individual Boating activity keeps Sailing chart recommendations. The family color and icon do not replace its exact type behavior.',
  },
  {
    icon: 'accessible_forward',
    title: 'Adaptive Mobility stays type-aware',
    copy: 'Wheel Chair is organized in Adaptive Mobility and keeps Cycling chart recommendations when compatible source metrics are present. This does not make it a Cycling Training claim.',
  },
  {
    icon: 'pedal_bike',
    title: 'Cycling has expanded coverage',
    copy: 'Hand Cycle and Velomobile are Cycling types. They use existing Cycling chart recommendations and can enter Cycling Training analysis only when current evidence rules are met.',
  },
];

export const SUPPORTED_ACTIVITIES_ROUTE_DATA: SupportedActivitiesRouteData = {
  title: 'Supported Activities & Metrics',
  preload: true,
  animation: 'Features',
  description: 'Browse the canonical activity types Quantified Self recognizes, how they are grouped, and why available metrics and Event Details charts depend on the original activity source.',
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Supported Activities & Metrics',
    description: 'Browse the canonical activity types Quantified Self recognizes, how they are grouped, and why available metrics and Event Details charts depend on the original activity source.',
    url: SUPPORTED_ACTIVITIES_URL,
    inLanguage: 'en',
    isPartOf: {
      '@type': 'WebSite',
      name: 'Quantified Self',
      url: 'https://quantified-self.io',
    },
    mainEntity: {
      '@type': 'SoftwareApplication',
      name: 'Quantified Self',
      applicationCategory: 'HealthApplication',
      operatingSystem: 'Web',
      featureList: [
        'Canonical activity type catalog',
        'Source-dependent activity metrics',
        'Type-aware Event Details chart recommendations',
        'Source-native Diving presentation',
      ],
    },
  },
};
