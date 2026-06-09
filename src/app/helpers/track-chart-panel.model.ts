export interface TrackChartPoint {
  x: number;
  y: number | null;
  time: number;
}

export interface TrackChartZoneColorPiece {
  zone: string;
  color: string;
  gte?: number;
  lt?: number;
}

export interface TrackChartPanelSeries {
  id: string;
  activityID: string;
  activityName: string;
  color: string;
  streamType: string;
  displayName: string;
  unit: string;
  lineValues?: Float64Array;
  timeValues?: Float64Array;
  gradeColorValues?: Float64Array;
  gradeColorSourceType?: string;
  pointCount?: number;
  points?: TrackChartPoint[];
  zoneColorPieces?: TrackChartZoneColorPiece[];
}

export interface TrackChartPanelModel {
  dataType: string;
  displayName: string;
  unit: string;
  colorGroupKey: string;
  series: TrackChartPanelSeries[];
  minX: number;
  maxX: number;
}
