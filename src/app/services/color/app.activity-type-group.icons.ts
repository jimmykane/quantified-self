import { ActivityTypeGroups } from '@sports-alliance/sports-lib';

export const AppActivityTypeGroupIcons: { [key in ActivityTypeGroups]: string } = {
    [ActivityTypeGroups.Running]: 'directions_run',
    [ActivityTypeGroups.TrailRunning]: 'directions_run',
    [ActivityTypeGroups.Cycling]: 'directions_bike',
    [ActivityTypeGroups.MountainBiking]: 'terrain',
    [ActivityTypeGroups.Swimming]: 'pool',
    [ActivityTypeGroups.Performance]: 'workspace_premium',
    [ActivityTypeGroups.IndoorSports]: 'fitness_center',
    [ActivityTypeGroups.OutdoorAdventures]: 'hiking',
    [ActivityTypeGroups.WinterSports]: 'downhill_skiing',
    [ActivityTypeGroups.WaterSports]: 'waves',
    [ActivityTypeGroups.Diving]: 'scuba_diving',
    [ActivityTypeGroups.TeamRacket]: 'sports_soccer',
    [ActivityTypeGroups.Unspecified]: 'category',
};
