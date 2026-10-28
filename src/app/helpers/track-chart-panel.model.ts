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
  lineStyle?: 'solid' | 'dashed' | 'dotted' | 'dash-dot';
  streamType: string;
  displayName: string;
  unit: string;
  /** Untimed/derived rows connect adjacent points; whiskers have no line. */
  lineGapPolicy?: 'adjacent' | 'none';
  lineContinuity?: import('./event-chart-line-continuity.helper').EventLineContinuitySettings;
  /** Display-only, worker-prepared segment IDs; zero denotes an empty/invalid reading. */
  lineSegmentIds?: Uint32Array;
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
