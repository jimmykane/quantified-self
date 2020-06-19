import { ActivityTypeGroups } from '@sports-alliance/sports-lib/lib/activities/activity.types';

export const AppActivityTypeGroupColors: {[key in ActivityTypeGroups]: string} = {
  [ActivityTypeGroups.Running]: '#FDD300',
  [ActivityTypeGroups.TrailRunning]: '#FDD300',
  // [ActivityTypeGroups.TrailRunning]: '#aeea00',
  [ActivityTypeGroups.Cycling]: '#FF7C3B',
  [ActivityTypeGroups.Performance]: '#AFE443',
  [ActivityTypeGroups.IndoorSports]: '#FF467E',
  [ActivityTypeGroups.OutdoorAdventures]: '#55D781',
  [ActivityTypeGroups.WinterSports]: '#6289FE',
  [ActivityTypeGroups.WaterSports]: '#59C7FE',
  [ActivityTypeGroups.Diving]: '#72E3DE',
  [ActivityTypeGroups.TeamRacket]: '#9A7DEA',
  [ActivityTypeGroups.Unspecified]: '#A3ADB0',
};
