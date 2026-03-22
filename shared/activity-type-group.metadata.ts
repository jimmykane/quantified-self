import {
  ActivityTypeGroups,
  type ActivityTypeGroup,
  ActivityTypes,
  ActivityTypesHelper,
} from '@sports-alliance/sports-lib';

export interface ActivityTypeGroupMetadata {
  id: ActivityTypeGroup;
  label: string;
  aliases: string[];
  ambiguous: boolean;
}

const ActivityTypeGroupMetadataMap: Record<ActivityTypeGroup, ActivityTypeGroupMetadata> = {
  [ActivityTypeGroups.RunningGroup]: {
    id: ActivityTypeGroups.RunningGroup,
    label: 'Running',
    aliases: ['running', 'running group', 'running family', 'running activities', 'all running activities'],
    ambiguous: true,
  },
  [ActivityTypeGroups.TrailRunningGroup]: {
    id: ActivityTypeGroups.TrailRunningGroup,
    label: 'Trail Running',
    aliases: ['trail running', 'trail running group', 'trail running family', 'trail running activities'],
    ambiguous: true,
  },
  [ActivityTypeGroups.CyclingGroup]: {
    id: ActivityTypeGroups.CyclingGroup,
    label: 'Cycling',
    aliases: ['cycling', 'cycling group', 'cycling family', 'cycling activities'],
    ambiguous: true,
  },
  [ActivityTypeGroups.MountainBikingGroup]: {
    id: ActivityTypeGroups.MountainBikingGroup,
    label: 'Mountain Biking',
    aliases: ['mountain biking', 'mountain biking group', 'mountain biking family', 'mountain biking activities', 'mtb', 'mtb group', 'mtb family'],
    ambiguous: true,
  },
  [ActivityTypeGroups.SwimmingGroup]: {
    id: ActivityTypeGroups.SwimmingGroup,
    label: 'Swimming',
    aliases: ['swimming', 'swimming group', 'swimming family', 'swimming activities'],
    ambiguous: true,
  },
  [ActivityTypeGroups.PerformanceGroup]: {
    id: ActivityTypeGroups.PerformanceGroup,
    label: 'Performance',
    aliases: ['performance', 'performance group', 'performance sports'],
    ambiguous: false,
  },
  [ActivityTypeGroups.IndoorSportsGroup]: {
    id: ActivityTypeGroups.IndoorSportsGroup,
    label: 'Indoor Sports',
    aliases: [
      'indoor sports',
      'indoor sports group',
      'indoor sports family',
      'indoorsports',
      'indoor type',
      'indoor types',
      'indoor activity',
      'indoor activities',
      'indoor activity type',
      'indoor activity types',
    ],
    ambiguous: false,
  },
  [ActivityTypeGroups.OutdoorAdventuresGroup]: {
    id: ActivityTypeGroups.OutdoorAdventuresGroup,
    label: 'Outdoor Adventures',
    aliases: ['outdoor adventures', 'outdoor adventures group', 'outdoor adventures family', 'outdooradventures'],
    ambiguous: false,
  },
  [ActivityTypeGroups.WinterSportsGroup]: {
    id: ActivityTypeGroups.WinterSportsGroup,
    label: 'Winter Sports',
    aliases: ['winter sports', 'winter sports group', 'winter sports family', 'wintersports'],
    ambiguous: false,
  },
  [ActivityTypeGroups.WaterSportsGroup]: {
    id: ActivityTypeGroups.WaterSportsGroup,
    label: 'Water Sports',
    aliases: ['water sports', 'water sports group', 'water sports family', 'watersports'],
    ambiguous: false,
  },
  [ActivityTypeGroups.DivingGroup]: {
    id: ActivityTypeGroups.DivingGroup,
    label: 'Diving',
    aliases: ['diving', 'diving group', 'diving family', 'diving activities'],
    ambiguous: true,
  },
  [ActivityTypeGroups.TeamRacketGroup]: {
    id: ActivityTypeGroups.TeamRacketGroup,
    label: 'Team Racket',
    aliases: ['team racket', 'team racket group', 'team racket family', 'teamracket'],
    ambiguous: false,
  },
  [ActivityTypeGroups.UnspecifiedGroup]: {
    id: ActivityTypeGroups.UnspecifiedGroup,
    label: 'Unspecified',
    aliases: [],
    ambiguous: false,
  },
};

function normalizeActivityTypeGroupLookupKey(value: string): string {
  return value.toLowerCase().replace(/[\s_-]/g, '');
}

export function getActivityTypeGroupMetadata(activityTypeGroup: ActivityTypeGroup): ActivityTypeGroupMetadata {
  return ActivityTypeGroupMetadataMap[activityTypeGroup];
}

export function getActivityTypeGroupMetadataList(): ActivityTypeGroupMetadata[] {
  return Object.values(ActivityTypeGroupMetadataMap);
}

export function getActivityTypeGroupLabel(activityTypeGroup: ActivityTypeGroup): string {
  return getActivityTypeGroupMetadata(activityTypeGroup)?.label || String(activityTypeGroup);
}

export function isAmbiguousActivityTypeGroup(activityTypeGroup: ActivityTypeGroup): boolean {
  return Boolean(getActivityTypeGroupMetadata(activityTypeGroup)?.ambiguous);
}

export function resolveActivityTypeGroup(value: unknown): ActivityTypeGroup | null {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const normalizedRaw = normalizeActivityTypeGroupLookupKey(raw);

  const directIdMatch = (Object.values(ActivityTypeGroups) as ActivityTypeGroup[])
    .find(activityTypeGroup => normalizeActivityTypeGroupLookupKey(activityTypeGroup) === normalizedRaw);
  if (directIdMatch) {
    return directIdMatch;
  }

  for (const [enumKey, enumValue] of Object.entries(ActivityTypeGroups) as Array<[string, ActivityTypeGroup]>) {
    const metadata = getActivityTypeGroupMetadata(enumValue);
    const searchValues = [
      enumKey,
      metadata.label,
      ...metadata.aliases,
    ];

    if (searchValues.some(candidate => normalizeActivityTypeGroupLookupKey(candidate) === normalizedRaw)) {
      return enumValue;
    }
  }

  return null;
}

export function getActivityTypesForGroup(activityTypeGroup: ActivityTypeGroup): ActivityTypes[] {
  const helper = ActivityTypesHelper as unknown as {
    getActivityTypesForActivityGroup?: (group: ActivityTypeGroup) => ActivityTypes[];
    getActivityGroupForActivityType?: (activityType: ActivityTypes) => ActivityTypeGroup;
  };

  if (typeof helper.getActivityTypesForActivityGroup === 'function') {
    try {
      return helper.getActivityTypesForActivityGroup(activityTypeGroup);
    } catch {
      // Fall through to group-by-activity lookup so module initialization cannot fail.
    }
  }

  if (typeof helper.getActivityGroupForActivityType === 'function') {
    const deduped = new Set<ActivityTypes>();
    for (const activityType of Object.values(ActivityTypes) as ActivityTypes[]) {
      try {
        if (helper.getActivityGroupForActivityType(activityType) === activityTypeGroup) {
          deduped.add(activityType);
        }
      } catch {
        // Ignore malformed values and continue collecting valid members.
      }
    }
    return [...deduped];
  }

  return [];
}

const EXPLICIT_INDOOR_ACTIVITY_TYPES = new Set<ActivityTypes>([
  ...getActivityTypesForGroup(ActivityTypeGroups.IndoorSportsGroup),
  ActivityTypes.IndoorCycling,
  ActivityTypes.IndoorRunning,
  ActivityTypes.IndoorTraining,
  ActivityTypes['Indoor Climbing'],
  ActivityTypes.Treadmill,
]);

export function isIndoorActivityType(activityType: ActivityTypes): boolean {
  return EXPLICIT_INDOOR_ACTIVITY_TYPES.has(activityType);
}
