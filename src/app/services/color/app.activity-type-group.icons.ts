import { ActivityTypeGroups, type ActivityTypeGroup } from '@sports-alliance/sports-lib';

export const AppActivityTypeGroupIcons: Record<ActivityTypeGroup, string> = {
    [ActivityTypeGroups.RunningGroup]: 'directions_run',
    [ActivityTypeGroups.TrailRunningGroup]: 'directions_run',
    [ActivityTypeGroups.CyclingGroup]: 'directions_bike',
    [ActivityTypeGroups.MountainBikingGroup]: 'terrain',
    [ActivityTypeGroups.SwimmingGroup]: 'pool',
    [ActivityTypeGroups.PerformanceGroup]: 'workspace_premium',
    [ActivityTypeGroups.IndoorSportsGroup]: 'fitness_center',
    [ActivityTypeGroups.OutdoorAdventuresGroup]: 'hiking',
    [ActivityTypeGroups.WinterSportsGroup]: 'downhill_skiing',
    [ActivityTypeGroups.WaterSportsGroup]: 'waves',
    [ActivityTypeGroups.DivingGroup]: 'scuba_diving',
    [ActivityTypeGroups.TeamRacketGroup]: 'sports_soccer',
    [ActivityTypeGroups.UnspecifiedGroup]: 'category',
};
