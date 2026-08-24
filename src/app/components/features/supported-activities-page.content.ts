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
    label: entry.id === ActivityTypeGroups.UnspecifiedGroup ? 'Other activities' : entry.label,
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
    title: 'Recognized type',
    copy: 'The catalog shows the activity types Quantified Self recognizes and the groups that help you browse them.',
  },
  {
    icon: 'query_stats',
    title: 'Shown when recorded',
    copy: 'Maps, terrain, sensors, laps, swim lengths, jumps, charts, and sport-specific details appear only when the activity includes the relevant data.',
  },
  {
    icon: 'stacked_line_chart',
    title: 'Charts fit the activity',
    copy: 'Groups help you browse. The activity type and its data determine which charts you see, so activities in the same group can still look different.',
  },
  {
    icon: 'sync',
    title: 'Your source matters',
    copy: 'Devices, connected services, file formats, and recording settings can all change the details that arrive with an activity.',
  },
];

export const SUPPORTED_ACTIVITY_SPECIALIZED_SURFACES: readonly SupportedActivityContentItem[] = [
  {
    icon: 'table_rows',
    title: 'Laps and swim lengths',
    copy: 'Laps appear when the activity includes lap data. Swimming activities can show Swim Lengths when the data includes individual pool lengths.',
  },
  {
    icon: 'landscape',
    title: 'Jump details',
    copy: 'Jumps appear when the activity includes jump events. The columns match the measurements in the activity.',
  },
  {
    icon: 'stacked_line_chart',
    title: 'Charts for recorded data',
    copy: 'Charts and overlays need data recorded over time in the activity. We show useful recorded data instead of filling in a missing metric.',
  },
];

export const SUPPORTED_ACTIVITIES_ROUTE_DATA: SupportedActivitiesRouteData = {
  title: 'Supported Activity Types',
  preload: true,
  animation: 'Features',
  description: 'Browse the activity types Quantified Self recognizes. The metrics, maps, laps, charts, and sport-specific details shown for an activity depend on data from its device, connected service, or uploaded file.',
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Supported Activity Types',
    description: 'Browse the activity types Quantified Self recognizes. The metrics, maps, laps, charts, and sport-specific details shown for an activity depend on data from its device, connected service, or uploaded file.',
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
        'Activity type catalog',
        'Details based on recorded activity data',
        'Charts based on activity type and recorded data',
        'Dive details based on recorded activity data',
      ],
    },
  },
};
