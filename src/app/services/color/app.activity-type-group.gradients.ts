import { ActivityTypeGroups } from '@sports-alliance/sports-lib';

export const AppActivityTypeGroupGradients: { [key in ActivityTypeGroups]: { start: string; end: string } } = {
    [ActivityTypeGroups.Running]: { start: '#FDD300', end: '#FF9100' },          // Yellow -> Deep Orange
    [ActivityTypeGroups.TrailRunning]: { start: '#c7ef0c', end: '#8bc34a' },     // Lime -> Light Green
    [ActivityTypeGroups.Cycling]: { start: '#FF7C3B', end: '#d84315' },          // Orange -> Burnt Orange
    [ActivityTypeGroups.Swimming]: { start: '#40C4FF', end: '#0288D1' },         // Light Blue -> Blue
    [ActivityTypeGroups.Performance]: { start: '#AFE443', end: '#689F38' },      // Light Green -> Dark Green
    [ActivityTypeGroups.IndoorSports]: { start: '#FF467E', end: '#C2185B' },     // Pink -> Dark Pink
    [ActivityTypeGroups.OutdoorAdventures]: { start: '#55D781', end: '#2E7D32' },// Emerald -> Forest Green
    [ActivityTypeGroups.WinterSports]: { start: '#6289FE', end: '#303F9F' },     // Blue -> Indigo
    [ActivityTypeGroups.WaterSports]: { start: '#59C7FE', end: '#0277BD' },      // Cyan -> Dark Blue
    [ActivityTypeGroups.Diving]: { start: '#72E3DE', end: '#0097A7' },           // Teal -> Cyan
    [ActivityTypeGroups.TeamRacket]: { start: '#9A7DEA', end: '#512DA8' },       // Purple -> Deep Purple
    [ActivityTypeGroups.Unspecified]: { start: '#A3ADB0', end: '#546E7A' },      // Grey -> Blue Grey
};
