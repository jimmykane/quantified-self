import { afterEach, describe, expect, it, vi } from 'vitest';
import { init, use, type EChartsType } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { DataZoomComponent, LegendComponent, GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { TimelineNote } from '@shared/timeline-notes';
import { TimelineNotesChartBinding } from './timeline-notes-chart.helper';
import { ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS } from './echarts-host-controller';

use([LineChart, DataZoomComponent, LegendComponent, GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent, SVGRenderer]);

describe('Timeline note tooltips with the real ECharts renderer', () => {
  let chart: EChartsType | undefined;
  let host: HTMLDivElement | undefined;
  afterEach(() => { chart?.dispose(); host?.remove(); vi.restoreAllMocks(); });

  it('merges note edits and removals without resetting readings, zoom or legend selection', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: (text: string) => ({ width: text.length * 6 }),
    } as never);
    host = document.createElement('div'); document.body.append(host);
    chart = init(host, null, { renderer: 'svg', width: 400, height: 300 });
    const binding = new TimelineNotesChartBinding();
    const reportRange = vi.fn();
    const note: TimelineNote = { id: 'sample', category: 'travel', title: 'Trip', startDate: '2026-09-02',
      endDate: '2026-09-04', timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
    const context = { notes: [note], select: vi.fn(), reportRange };
    const data = [1, 2, 3, 4, 5, 6].map(day => [Date.UTC(2026, 8, day), day * 10]);
    const option = { animation: false, xAxis: { type: 'time', min: data[0][0], max: data.at(-1)![0] }, yAxis: {},
      legend: { data: ['HRV', 'Other'] }, dataZoom: [{ type: 'inside' }],
      series: [{ type: 'line', name: 'HRV', data }, { type: 'line', name: 'Other', data }] };
    // First notes can arrive after the readings, including metric series without explicit IDs.
    chart.setOption(binding.apply(chart, option));
    chart.dispatchAction({ type: 'dataZoom', start: 10, end: 90 });
    chart.dispatchAction({ type: 'legendUnSelect', name: 'Other' });
    const before = chart.getOption() as any;
    const update = (next: typeof context | null) => {
      binding.set(next);
      const patch = binding.update(chart!);
      if (patch) chart!.setOption(patch, { notMerge: false, lazyUpdate: false });
      const current = chart!.getOption() as any;
      expect(current.series.slice(0, 2)).toEqual(before.series);
      expect(current.dataZoom).toEqual(before.dataZoom);
      expect(current.legend).toEqual(before.legend);
      expect(current.xAxis).toEqual(before.xAxis);
      expect(current.yAxis).toEqual(before.yAxis);
      return current.series.find((series: any) => series.id === 'timeline-note-overlay-0');
    };
    expect(update(context).markArea.data).toHaveLength(1);
    expect(update({ ...context, notes: [{ ...note, title: 'Updated', endDate: note.startDate }] }).markArea.data).toEqual([]);
    expect(update({ ...context, notes: [] }).markLine.data).toEqual([]);
    expect(update(context).markLine.data).toHaveLength(2);
    expect(reportRange).toHaveBeenCalledOnce();
    const hidden = update(null);
    expect(hidden.markLine.data).toEqual([]);
    expect(hidden.markArea.data).toEqual([]);
    expect(reportRange).toHaveBeenLastCalledWith(binding, null);
    expect(update(context).markArea.data).toHaveLength(1);
    // A subsequent data refresh replaces the metric window and removes overlays outside it.
    chart.setOption(binding.apply(chart, { ...option, xAxis: { type: 'time', min: Date.UTC(2026, 9, 1), max: Date.UTC(2026, 9, 10) } }), ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    expect((chart.getOption() as any).series).toHaveLength(2);
    binding.dispose();
    expect(binding.update(chart)).toBeNull();
  });

  it.each(['mousemove', 'click'])('keeps metric tooltips inside note ranges and note tooltips on boundaries (%s)', trigger => {
    // SVG renders the real markers; JSDOM only needs a deterministic text measurement shim.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: (text: string) => ({ width: text.length * 6 }),
    } as never);
    host = document.createElement('div'); document.body.append(host);
    chart = init(host, null, { renderer: 'svg', width: 800, height: 400 });
    const day = (date: string) => Date.parse(`${date}T00:00:00Z`);
    const note: TimelineNote = { id: 'sample', category: 'travel', title: 'Weekend <away>', startDate: '2026-09-02',
      endDate: '2026-09-04', timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
    const select = vi.fn();
    const binding = new TimelineNotesChartBinding();
    binding.set({ notes: [note], select, reportRange: vi.fn() });
    chart.setOption(binding.apply(chart, { animation: false,
      grid: { left: 40, right: 40, top: 40, bottom: 40 },
      xAxis: { type: 'time', min: day('2026-09-01'), max: day('2026-09-10') }, yAxis: { min: 0, max: 100 },
      tooltip: { trigger: 'axis', triggerOn: trigger, renderMode: 'html', transitionDuration: 0, hideDelay: 0,
        formatter: () => 'Metric reading' },
      series: [{ type: 'line', data: [[day('2026-09-01'), 50], [day('2026-09-03'), 50], [day('2026-09-10'), 50]] }],
    }));
    const [x, y] = chart.convertToPixel({ gridIndex: 0 }, [day('2026-09-03'), 25]);
    chart.getZr().trigger(trigger, { offsetX: x, offsetY: y, target: chart.getZr().findHover(x, y).target,
      event: new MouseEvent(trigger) });
    expect(host.textContent).toContain('Metric reading');
    expect(host.querySelector('.qs-dashboard-echarts-tooltip-card')).toBeNull();
    const [readingX, readingY] = chart.convertToPixel({ gridIndex: 0 }, [day('2026-09-03'), 50]);
    chart.getZr().trigger(trigger, { offsetX: readingX, offsetY: readingY, target: chart.getZr().findHover(readingX, readingY).target,
      event: new MouseEvent(trigger) });
    expect(host.textContent).toContain('Metric reading');
    for (const timestamp of [day('2026-09-02'), day('2026-09-05') - 1]) {
      const [boundaryX, boundaryY] = chart.convertToPixel({ gridIndex: 0 }, [timestamp, 25]);
      chart.getZr().trigger(trigger, { offsetX: boundaryX, offsetY: boundaryY, target: chart.getZr().findHover(boundaryX, boundaryY).target,
        event: new MouseEvent(trigger) });
      const tooltip = host.querySelector('.qs-dashboard-echarts-tooltip-card');
      expect(tooltip?.textContent).toContain('Travel: Weekend <away>');
      expect(tooltip?.textContent).toContain('2026-09-02 – 2026-09-04');
      expect(tooltip?.innerHTML).toContain('Weekend &lt;away&gt;');
    }
    expect(select).not.toHaveBeenCalled();
    binding.dispose();
  });
});
