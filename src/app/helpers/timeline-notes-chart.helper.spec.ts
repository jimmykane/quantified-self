import { describe, expect, it, vi } from 'vitest';
import { addTimelineNotesToChart, groupTimelineNotes, TimelineNotesChartBinding } from './timeline-notes-chart.helper';
import type { TimelineNote } from '@shared/timeline-notes';
import { buildDashboardEChartsStyleTokens, buildDashboardEChartsTooltipChrome, renderDashboardEChartsTooltipCard } from './dashboard-echarts-style.helper';
const date = (day: string) => Date.parse(`${day}T00:00:00Z`);
const note: TimelineNote = { id: 'a'.repeat(64), category: 'sickness', title: '<script>private</script>', startDate: '2026-09-02', endDate: '2026-09-04', timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
const option = { xAxis: { type: 'time', min: date('2026-09-01'), max: date('2026-09-10') }, yAxis: { min: 0 },
  series: [{ name: 'HR', type: 'line', data: [[date('2026-09-01'), 65], [date('2026-09-03'), null]], markArea: { data: [[{ yAxis: 60 }, { yAxis: 70 }]] } }] };
describe('timeline chart overlays', () => {
  it.each([[false, 320], [true, 320], [false, 1000], [true, 1000]] as const)('uses the shared tooltip card and chrome (dark: %s, width: %s)', (darkTheme, width) => {
    const style = buildDashboardEChartsStyleTokens(darkTheme, width);
    const result = addTimelineNotesToChart(option, [note], {}, date('2026-09-10'), style);
    const overlay = result.option.series[1];
    const tooltip = overlay.markLine.data[0].tooltip;
    expect(tooltip).toMatchObject(buildDashboardEChartsTooltipChrome(style));
    expect(tooltip.formatter()).toBe(renderDashboardEChartsTooltipCard(style, {
      title: 'Sickness: <script>private</script>', subtitle: '2026-09-02 – 2026-09-04', stackHeader: true,
    }));
    expect(tooltip.formatter()).toContain('overflow-wrap:anywhere');
    expect(tooltip.formatter()).not.toContain('<script>');
    expect(overlay.markArea.data[0][0].tooltip).toBe(tooltip);
  });
  it('keeps overlapping notes in separate wrapped cards with their original dates', () => {
    const ongoing = { ...note, id: 'b', title: 'A long note '.repeat(10), startDate: '2026-09-03', endDate: null };
    const result = addTimelineNotesToChart(option, [note, ongoing], {}, date('2026-09-05'));
    const html = result.option.series[1].markLine.data[0].tooltip.formatter();
    const content = document.createElement('div'); content.innerHTML = html;
    const cards = content.querySelectorAll('.qs-dashboard-echarts-tooltip-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('2026-09-02 – 2026-09-04');
    expect(cards[1].textContent).toContain('2026-09-03 – ongoing');
    expect(cards[1].textContent).toContain(ongoing.title.trim());
    expect(html).toContain('max-width:min(260px, calc(100vw - 32px))');
  });
  it('excludes hidden notes from markers, bands, group counts and tooltips without changing readings', () => {
    const hidden = { ...note, id: 'b'.repeat(64), title: 'Hidden private note', showOnCharts: false };
    const result = addTimelineNotesToChart(option, [note, hidden]);
    expect([...result.groups.values()]).toEqual([[note]]);
    expect(result.option.series[1].markLine.data[0].tooltip.formatter()).not.toContain(hidden.title);
    expect(result.option.series[0]).toBe(option.series[0]);
    expect(addTimelineNotesToChart(option, [hidden]).option).toBe(option);
  });
  it('preserves metrics, gaps, axes and reference bands and escapes user text', () => {
    const result = addTimelineNotesToChart(option, [note]);
    expect(result.option.xAxis).toBe(option.xAxis); expect(result.option.yAxis).toBe(option.yAxis);
    expect(result.option.series[0]).toBe(option.series[0]);
    const overlay = result.option.series[1];
    expect(overlay.data).toEqual([]);
    expect(overlay.markLine.data[0].tooltip.formatter()).toContain('&lt;script&gt;');
    expect(overlay.markArea.data).toHaveLength(1);
    expect(overlay.markLine.data[0].label).toMatchObject({ rotate: 0, opacity: 1 });
  });
  it('groups overlaps, leaves unrelated periods distinct, and clips ongoing at today', () => {
    const groups = groupTimelineNotes([note, { ...note, id: 'b', startDate: '2026-09-03', endDate: null },
      { ...note, id: 'c', startDate: '2026-09-09', endDate: '2026-09-09' }], { startDate: '2026-09-01', endDate: '2026-09-10' }, date('2026-09-05'));
    expect(groups.map(group => group.notes.length)).toEqual([2, 1]);
    expect(groups[0].endDate).toBe('2026-09-05');
  });
  it('uses normalized Sleep dates, including duplicate source dates', () => {
    const result = addTimelineNotesToChart({ xAxis: { type: 'category', data: ['a', 'b', 'c'] }, series: [{ data: [1, 2, 3] }] },
      [note], { categoryDates: ['2026-09-02', '2026-09-02', '2026-09-03'] });
    expect(result.range).toEqual({ startDate: '2026-09-02', endDate: '2026-09-03' });
    expect(result.option.series[1].markArea.data[0][0].xAxis).toBe(0);
    expect(result.option.series[1].markArea.data[0][1].xAxis).toBe(2);
  });
  it('maps partial-week notes to weekly categories but keeps actual note dates in tooltips', () => {
    const result = addTimelineNotesToChart({ xAxis: { type: 'category', data: [date('2026-08-31'), date('2026-09-07')] }, series: [{ data: [1, 2] }] }, [note], { bucketDays: 7 });
    expect(result.option.series[1].markLine.data[0].xAxis).toBe(0);
    expect(result.option.series[1].markLine.data[0].tooltip.formatter()).toContain('2026-09-02 – 2026-09-04');
  });
  it('uses recorded offsets rather than viewer timezone on Health time axes', () => {
    const result = addTimelineNotesToChart(option, [note], { offsetSeconds: () => 10_800 });
    expect(result.option.series[1].markLine.data[0].xAxis).toBe(date('2026-09-02') - 10_800_000);
  });
  it('groups distinct days that occupy the same weekly marker, retaining every actual date', () => {
    const first = { ...note, startDate: '2026-09-01', endDate: '2026-09-01' };
    const second = { ...note, id: 'b'.repeat(64), startDate: '2026-09-04', endDate: '2026-09-04' };
    const result = addTimelineNotesToChart({ xAxis: { type: 'category', data: [date('2026-08-31'), date('2026-09-07')] },
      series: [{ data: [1, 2] }] }, [first, second], { bucketDays: 7 });
    const markers = result.option.series[1].markLine.data;
    expect(markers).toHaveLength(1);
    expect(result.groups.get(markers[0].name)).toEqual([first, second]);
    expect(markers[0].tooltip.formatter()).toContain('2026-09-01');
    expect(markers[0].tooltip.formatter()).toContain('2026-09-04');
    expect(result.option.series[1].markArea.data).toEqual([]);
  });
  it('groups notes clipped to the final weekly time point without changing other markers or period bands', () => {
    const first = { ...note, startDate: '2026-09-08', endDate: '2026-09-08' };
    const second = { ...note, id: 'b'.repeat(64), startDate: '2026-09-11', endDate: '2026-09-11' };
    const period = { ...note, id: 'c'.repeat(64) };
    const source = { xAxis: { type: 'time', min: date('2026-08-31'), max: date('2026-09-07') },
      series: [{ data: [[date('2026-08-31'), 1], [date('2026-09-07'), 2]] }] };
    const result = addTimelineNotesToChart(source, [first, second, period], { bucketDays: 7 });
    const overlay = result.option.series[1];
    expect(overlay.markLine.data).toHaveLength(2);
    expect(result.groups.get(overlay.markLine.data[1].name)).toEqual([first, second]);
    expect(overlay.markLine.data[1].xAxis).toBe(date('2026-09-07'));
    expect(overlay.markArea.data).toHaveLength(1);
    expect(result.option.series[0]).toBe(source.series[0]);
  });
  it('does nothing for empty, unannotated and non-date charts', () => {
    expect(addTimelineNotesToChart(option, []).option).toBe(option);
    expect(addTimelineNotesToChart({ series: [] }, [note]).range).toBeNull();
    expect(addTimelineNotesToChart({ xAxis: { type: 'value' }, series: [{ data: [1] }] }, [note]).range).toBeNull();
  });
  it('annotates both Form axes and releases click handlers and range registrations', () => {
    const result = addTimelineNotesToChart({ ...option, xAxis: [option.xAxis, option.xAxis], series: [option.series[0], { ...option.series[0], xAxisIndex: 1, yAxisIndex: 1 }] }, [note]);
    expect(result.option.series).toHaveLength(4);
    const chart = { on: vi.fn(), off: vi.fn(), getWidth: () => 320 };
    const context = { notes: [note], select: vi.fn(), reportRange: vi.fn() };
    const binding = new TimelineNotesChartBinding(); binding.set(context); binding.apply(chart as never, option);
    chart.on.mock.calls[0][1]({ name: 'timeline-note-0-0', componentType: 'markLine' });
    expect(context.select).toHaveBeenCalledWith([note]);
    binding.dispose(); expect(chart.off).toHaveBeenCalledOnce(); expect(context.reportRange).toHaveBeenLastCalledWith(binding, null);
  });
  it('uses the active chart theme and width for note tooltips on every render', () => {
    const chart = { on: vi.fn(), off: vi.fn(), getWidth: vi.fn().mockReturnValue(320) };
    const binding = new TimelineNotesChartBinding();
    binding.set({ notes: [note], select: vi.fn(), reportRange: vi.fn() });
    const compact = binding.apply(chart as never, option, true).series[1].markLine.data[0].tooltip;
    expect(compact).toMatchObject(buildDashboardEChartsTooltipChrome(buildDashboardEChartsStyleTokens(true, 320)));
    chart.getWidth.mockReturnValue(1000);
    const wide = binding.apply(chart as never, option, false).series[1].markLine.data[0].tooltip;
    expect(wide).toMatchObject(buildDashboardEChartsTooltipChrome(buildDashboardEChartsStyleTokens(false, 1000)));
    expect(wide.formatter()).not.toBe(compact.formatter());
    binding.dispose();
  });
});
