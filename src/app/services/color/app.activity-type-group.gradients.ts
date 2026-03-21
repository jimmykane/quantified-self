import { ActivityTypeGroups, type ActivityTypeGroup } from '@sports-alliance/sports-lib';

export const AppActivityTypeGroupGradients: Record<ActivityTypeGroup, { start: string; end: string }> = {
    [ActivityTypeGroups.RunningGroup]: { start: '#FDD300', end: '#FF9100' },          // Yellow -> Deep Orange
    [ActivityTypeGroups.TrailRunningGroup]: { start: '#c7ef0c', end: '#8bc34a' },     // Lime -> Light Green
    [ActivityTypeGroups.CyclingGroup]: { start: '#FF7C3B', end: '#d84315' },          // Orange -> Burnt Orange
    [ActivityTypeGroups.MountainBikingGroup]: { start: '#FF9800', end: '#43A047' },   // Vibrant Orange -> Vibrant Green
    [ActivityTypeGroups.SwimmingGroup]: { start: '#40C4FF', end: '#0288D1' },         // Light Blue -> Blue
    [ActivityTypeGroups.PerformanceGroup]: { start: '#AFE443', end: '#689F38' },      // Light Green -> Dark Green
    [ActivityTypeGroups.IndoorSportsGroup]: { start: '#FF467E', end: '#C2185B' },     // Pink -> Dark Pink
    [ActivityTypeGroups.OutdoorAdventuresGroup]: { start: '#55D781', end: '#2E7D32' },// Emerald -> Forest Green
    [ActivityTypeGroups.WinterSportsGroup]: { start: '#6289FE', end: '#303F9F' },     // Blue -> Indigo
    [ActivityTypeGroups.WaterSportsGroup]: { start: '#59C7FE', end: '#0277BD' },      // Cyan -> Dark Blue
    [ActivityTypeGroups.DivingGroup]: { start: '#72E3DE', end: '#0097A7' },           // Teal -> Cyan
    [ActivityTypeGroups.TeamRacketGroup]: { start: '#9A7DEA', end: '#512DA8' },       // Purple -> Deep Purple
    [ActivityTypeGroups.UnspecifiedGroup]: { start: '#A3ADB0', end: '#546E7A' },      // Grey -> Blue Grey
};
