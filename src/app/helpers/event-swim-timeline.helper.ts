import type { CustomSeriesOption } from 'echarts/charts';
import type { EventChartSwimLengthMarker } from './event-echarts-data.helper';
import { resolveDeviceChartColor } from './device-chart-appearance.helper';

export const SWIM_TIMELINE_SERIES_ID = 'swim-rest-timeline';
export const SWIM_TIMELINE_LANE_HEIGHT = 22;
export interface SwimTimelineLane {
  activityID: string;
  activityName: string;
  color: string;
  lengths: EventChartSwimLengthMarker[];
}

/** Keep recorded gaps blank. Ambiguous overlapping spans cannot establish swim/rest state. */
export function buildSwimTimelineLanes(markers: readonly EventChartSwimLengthMarker[], darkTheme: boolean): SwimTimelineLane[] {
  const groups = new Map<string, EventChartSwimLengthMarker[]>();
  for (const marker of markers) {
    if (!Number.isFinite(marker.timelineStartXValue) || !Number.isFinite(marker.xValue)
      || marker.xValue <= marker.timelineStartXValue) continue;
    const group = groups.get(marker.activityID) || [];
    group.push(marker);
    groups.set(marker.activityID, group);
  }
  const lanes: SwimTimelineLane[] = [];
  for (const [activityID, lengths] of groups) {
    const sorted = [...lengths].sort((a, b) => a.timelineStartXValue - b.timelineStartXValue);
    const usable: EventChartSwimLengthMarker[] = [];
    let cluster: EventChartSwimLengthMarker[] = [];
    let end = -Infinity;
    const flush = () => {
      if (cluster.length === 1 && ['active', 'idle', 'rest'].includes(cluster[0].swimLengthType.trim().toLowerCase())) {
        usable.push(cluster[0]);
      }
    };
    for (const length of sorted) {
      if (length.timelineStartXValue >= end) {
        flush();
        cluster = [];
      }
      cluster.push(length);
      end = Math.max(end, length.xValue);
    }
    flush();
    if (usable.length) lanes.push({ activityID, activityName: usable[0].activityName,
      color: resolveDeviceChartColor(usable[0].color, darkTheme), lengths: usable });
  }
  return lanes;
}

/** A separate strip above the metric plot, using the same x axis and native zoom transform. */
export function buildSwimTimelineSeries(lanes: SwimTimelineLane[], interactive: boolean): CustomSeriesOption {
  const blocks = lanes.flatMap((lane, index) => lane.lengths.map(marker => ({
    ...marker, value: [marker.timelineStartXValue, marker.xValue, index],
    itemStyle: { color: lane.color },
  })));
  return {
    id: SWIM_TIMELINE_SERIES_ID, name: 'Swim / rest', type: 'custom',
    clip: false, silent: !interactive, animation: false, z: 4,
    dimensions: ['start', 'end', 'lane'], encode: { x: [0, 1], y: -1, tooltip: [] },
    data: blocks,
    renderItem: (params, api) => {
      const grid = params.coordSys as { type: string; x: number; y: number; width: number };
      const block = blocks[params.dataIndex];
      const left = Math.max(grid.x, api.coord([Number(api.value(0)), 0])[0]);
      const right = Math.min(grid.x + grid.width, api.coord([Number(api.value(1)), 0])[0]);
      if (!block || !Number.isFinite(left) || !Number.isFinite(right) || right <= left) return;
      return {
        type: 'rect',
        shape: { x: left, y: grid.y - (lanes.length - Number(api.value(2))) * SWIM_TIMELINE_LANE_HEIGHT,
          width: right - left, height: 14 },
        // Keep a filled hit target even for the visually hollow rest blocks (SVG and canvas).
        style: { fill: block.itemStyle.color, fillOpacity: block.isIdle ? 0 : 1,
          stroke: block.itemStyle.color, lineWidth: 1, lineDash: block.isIdle ? [3, 2] : undefined },
      };
    },
  };
}
