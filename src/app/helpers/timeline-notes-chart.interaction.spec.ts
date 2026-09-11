import { afterEach, describe, expect, it, vi } from 'vitest';
import { init, use, type EChartsType } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { TimelineNote } from '@shared/timeline-notes';
import { TimelineNotesChartBinding } from './timeline-notes-chart.helper';

use([LineChart, GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent, SVGRenderer]);

describe('Timeline note tooltips with the real ECharts renderer', () => {
  let chart: EChartsType | undefined;
  let host: HTMLDivElement | undefined;
  afterEach(() => { chart?.dispose(); host?.remove(); vi.restoreAllMocks(); });

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
