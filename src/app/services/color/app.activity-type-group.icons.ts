import { WALKING_ACTIVITY_TYPE_GROUP } from '@shared/activity-type-compatibility';
import { ActivityTypeGroups, type ActivityTypeGroup } from '@sports-alliance/sports-lib';

export const AppActivityTypeGroupIcons: Record<ActivityTypeGroup, string> = {
    ...{ [WALKING_ACTIVITY_TYPE_GROUP]: 'directions_walk' },
    [ActivityTypeGroups.RunningGroup]: 'directions_run',
    [ActivityTypeGroups.TrailRunningGroup]: 'directions_run',
    [ActivityTypeGroups.CyclingGroup]: 'directions_bike',
    [ActivityTypeGroups.MountainBikingGroup]: 'terrain',
    [ActivityTypeGroups.SwimmingGroup]: 'pool',
    [ActivityTypeGroups.PerformanceGroup]: 'workspace_premium',
    [ActivityTypeGroups.IndoorSportsGroup]: 'fitness_center',
    [ActivityTypeGroups.OutdoorAdventuresGroup]: 'hiking',
    [ActivityTypeGroups.WinterSportsGroup]: 'downhill_skiing',
    [ActivityTypeGroups.SkatingGroup]: 'roller_skating',
    [ActivityTypeGroups.AerialSportsGroup]: 'paragliding',
    [ActivityTypeGroups.MotorizedGroup]: 'directions_car',
    [ActivityTypeGroups.AdaptiveMobilityGroup]: 'accessible_forward',
    [ActivityTypeGroups.WaterSportsGroup]: 'waves',
    [ActivityTypeGroups.DivingGroup]: 'scuba_diving',
    [ActivityTypeGroups.TeamRacketGroup]: 'sports_soccer',
    [ActivityTypeGroups.UnspecifiedGroup]: 'category',
};
