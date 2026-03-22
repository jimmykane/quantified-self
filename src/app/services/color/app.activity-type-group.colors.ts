import { ActivityTypeGroups, type ActivityTypeGroup } from '@sports-alliance/sports-lib';

export const AppActivityTypeGroupColors: Record<ActivityTypeGroup, string> = {
  [ActivityTypeGroups.RunningGroup]: '#FDD300',
  [ActivityTypeGroups.TrailRunningGroup]: '#c7ef0c',
  [ActivityTypeGroups.CyclingGroup]: '#FF7C3B',
  [ActivityTypeGroups.MountainBikingGroup]: '#B6C83A',
  [ActivityTypeGroups.SwimmingGroup]: '#40C4FF',
  [ActivityTypeGroups.PerformanceGroup]: '#AFE443',
  [ActivityTypeGroups.IndoorSportsGroup]: '#FF467E',
  [ActivityTypeGroups.OutdoorAdventuresGroup]: '#55D781',
  [ActivityTypeGroups.WinterSportsGroup]: '#6289FE',
  [ActivityTypeGroups.WaterSportsGroup]: '#59C7FE',
  [ActivityTypeGroups.DivingGroup]: '#72E3DE',
  [ActivityTypeGroups.TeamRacketGroup]: '#9A7DEA',
  [ActivityTypeGroups.UnspecifiedGroup]: '#A3ADB0',
};
