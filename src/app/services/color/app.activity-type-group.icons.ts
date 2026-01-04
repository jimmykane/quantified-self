import { ActivityTypeGroups } from '@sports-alliance/sports-lib';

export const AppActivityTypeGroupIcons: { [key in ActivityTypeGroups]: string } = {
    [ActivityTypeGroups.Running]: 'directions_run',
    [ActivityTypeGroups.TrailRunning]: 'directions_run',
    [ActivityTypeGroups.Cycling]: 'directions_bike',
    [ActivityTypeGroups.Swimming]: 'pool',
    [ActivityTypeGroups.Performance]: 'workspace_premium',
    [ActivityTypeGroups.IndoorSports]: 'fitness_center',
    [ActivityTypeGroups.OutdoorAdventures]: 'hiking',
    [ActivityTypeGroups.WinterSports]: 'ac_unit',
    [ActivityTypeGroups.WaterSports]: 'rowing',
    [ActivityTypeGroups.Diving]: 'scuba_diving',
    [ActivityTypeGroups.TeamRacket]: 'sports_tennis',
    [ActivityTypeGroups.Unspecified]: 'sports',
};
