import { describe, expect, it, vi } from 'vitest';
import { addTimelineNotesToChart, groupTimelineNotes, TimelineNotesChartBinding } from './timeline-notes-chart.helper';
import type { TimelineNote } from '@shared/timeline-notes';
import { buildDashboardEChartsStyleTokens, buildDashboardEChartsTooltipChrome, renderDashboardEChartsTooltipCard } from './dashboard-echarts-style.helper';
import { AppColors } from '../services/color/app.colors';
const date = (day: string) => Date.parse(`${day}T00:00:00Z`);
const note: TimelineNote = { id: 'a'.repeat(64), category: 'sickness', title: '<script>private</script>', startDate: '2026-09-02', endDate: '2026-09-04', timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
const option = { xAxis: { type: 'time', min: date('2026-09-01'), max: date('2026-09-10') }, yAxis: { min: 0 },
  series: [{ name: 'HR', type: 'line', data: [[date('2026-09-01'), 65], [date('2026-09-03'), null]], markArea: { data: [[{ yAxis: 60 }, { yAxis: 70 }]] } }] };
describe('timeline chart overlays', () => {
  it('brackets a period at its start and inclusive end without duplicating its title', () => {
    const result = addTimelineNotesToChart(option, [note]);
    const overlay = result.option.series[1];
    const [start, end] = overlay.markLine.data;
    expect(overlay.markLine.data).toHaveLength(2);
    expect(start).toMatchObject({ xAxis: date(note.startDate), symbol: 'arrow', symbolRotate: -90 });
    expect(end).toMatchObject({ xAxis: date('2026-09-05') - 1, symbol: 'arrow', symbolRotate: 90, label: { show: false } });
    expect(end.name).toBe(start.name);
    expect(end.tooltip).toBe(start.tooltip);
    expect(result.groups.get(end.name)).toEqual([note]);
    expect(overlay.markArea.data[0].map(boundary => boundary.xAxis)).toEqual([start.xAxis, end.xAxis]);
    expect(result.option.xAxis).toBe(option.xAxis);
    expect(result.option.series[0]).toBe(option.series[0]);
  });
  it('keeps single days as one marker without a period band', () => {
    const single = { ...note, endDate: note.startDate };
    const overlay = addTimelineNotesToChart(option, [single]).option.series[1];
    expect(overlay.markLine.data).toHaveLength(1);
    expect(overlay.markLine.data[0].symbol).toBe('circle');
    expect(overlay.markArea.data).toEqual([]);
  });
  it('shows an open ongoing end at today in the captured zone, not in the forecast', () => {
    const ongoing = { ...note, endDate: null, timeZone: 'Pacific/Honolulu' };
    const overlay = addTimelineNotesToChart(option, [ongoing], {}, date('2026-09-06')).option.series[1];
    const end = overlay.markLine.data[1];
    expect(end).toMatchObject({ xAxis: date('2026-09-06') - 1, symbol: 'emptyCircle', symbolRotate: 0 });
    expect(end.tooltip.formatter()).toContain('ongoing');
    expect(overlay.markArea.data[0][1].xAxis).toBe(end.xAxis);
  });
  it('uses open boundary markers when a period continues outside the visible window', () => {
    const spanning = { ...note, startDate: '2026-08-20', endDate: '2026-09-20' };
    const markers = addTimelineNotesToChart(option, [spanning]).option.series[1].markLine.data;
    expect(markers.map(marker => marker.symbol)).toEqual(['emptyCircle', 'emptyCircle']);
    expect(markers.map(marker => marker.xAxis)).toEqual([option.xAxis.min, option.xAxis.max]);
    expect(markers[1].tooltip.formatter()).toContain('2026-08-20 – 2026-09-20');
  });
  it('keeps compact title rows alternating when earlier notes have end markers', () => {
    const second = { ...note, id: 'b', startDate: '2026-09-06', endDate: '2026-09-08' };
    const result = addTimelineNotesToChart(option, [note, second], {}, date('2026-09-10'), buildDashboardEChartsStyleTokens(false, 320));
    const markers = result.option.series[1].markLine.data;
    expect(markers.filter(marker => marker.label.show).map(marker => marker.label.offset)).toEqual([[0, 0], [0, -14]]);
    expect(markers.map(marker => marker.name)).toEqual(['timeline-note-0-0', 'timeline-note-0-0', 'timeline-note-0-1', 'timeline-note-0-1']);
  });
  it('opens the same group from either period boundary through the existing selection handler', () => {
    const chart = { on: vi.fn(), off: vi.fn(), getWidth: () => 320, dispatchAction: vi.fn() };
    const context = { notes: [note, { ...note, id: 'b' }], select: vi.fn(), reportRange: vi.fn() };
    const binding = new TimelineNotesChartBinding();
    binding.set(context);
    const markers = binding.apply(chart as never, option).series[1].markLine.data;
    for (const marker of markers) chart.on.mock.calls[0][1]({ name: marker.name, componentType: 'markLine' });
    expect(context.select.mock.calls).toEqual([[context.notes], [context.notes]]);
    expect(chart.dispatchAction).toHaveBeenCalledTimes(2);
    binding.dispose();
  });
  it.each(['2026-09-02', '2026-09-04'])('labels single-day and period markers with the note title (end: %s)', endDate => {
    const named = { ...note, title: 'Vacation with family', endDate };
    const result = addTimelineNotesToChart(option, [named]);
    const marker = result.option.series[1].markLine.data[0];
    expect(marker.label.formatter()).toBe(named.title);
    expect(result.groups.get(marker.name)).toEqual([named]);
    expect(result.option.series[0]).toBe(option.series[0]);
  });
  it('renders template-like titles literally on one line without changing the stored title', () => {
    const named = { ...note, title: 'Trip {b} <West>\nwith family 🏝' };
    const marker = addTimelineNotesToChart(option, [named]).option.series[1].markLine.data[0];
    expect(typeof marker.label.formatter).toBe('function');
    expect(marker.label.formatter()).toBe('Trip {b} <West> with family 🏝');
    expect(marker.tooltip.formatter()).toContain('&lt;West&gt;');
    expect(named.title).toContain('\n');
  });
  it.each([[320, 100], [1000, 160]])('bounds long marker titles at chart width %s without losing the full title', (width, labelWidth) => {
    const named = { ...note, title: 'A long vacation title '.repeat(5).trim() };
    const marker = addTimelineNotesToChart(option, [named], {}, date('2026-09-10'),
      buildDashboardEChartsStyleTokens(false, width)).option.series[1].markLine.data[0];
    expect(marker.label).toMatchObject({ width: labelWidth, overflow: 'truncate', ellipsis: '…' });
    expect(marker.label.formatter()).toBe(named.title);
    expect(marker.tooltip.formatter()).toContain(named.title);
  });
  it.each([[false, 320], [true, 320], [false, 1000], [true, 1000]] as const)('uses the shared tooltip card and chrome (dark: %s, width: %s)', (darkTheme, width) => {
    const style = buildDashboardEChartsStyleTokens(darkTheme, width);
    const result = addTimelineNotesToChart(option, [{ ...note, color: 'purple' }], {}, date('2026-09-10'), style);
    const overlay = result.option.series[1];
    const tooltip = overlay.markLine.data[0].tooltip;
    expect(tooltip).toMatchObject(buildDashboardEChartsTooltipChrome(style));
    expect(tooltip.formatter()).toBe(renderDashboardEChartsTooltipCard(style, {
      title: 'Sickness: <script>private</script>', subtitle: '2026-09-02 – 2026-09-04', stackHeader: true,
    }));
    expect(tooltip.formatter()).toContain('overflow-wrap:anywhere');
    expect(tooltip.formatter()).not.toContain('<script>');
    expect(overlay.markArea.data[0][0].tooltip).toBe(tooltip);
    expect(overlay.markLine.data[0].itemStyle.color).toBe(AppColors.Purple);
    expect(overlay.markArea.data[0][0].itemStyle.color).toBe(AppColors.Purple);
  });
  it.each([[320, -14], [1000, 0]])('staggers adjacent titles only in compact charts (width: %s)', (width, offset) => {
    const notes = ['2026-09-02', '2026-09-04', '2026-09-06'].map((startDate, index) => ({
      ...note, id: String(index), title: `Travel ${index}`, startDate, endDate: startDate,
    }));
    const result = addTimelineNotesToChart(option, notes, {}, date('2026-09-10'), buildDashboardEChartsStyleTokens(false, width));
    const markers = result.option.series[1].markLine.data;
    expect(markers.map(marker => marker.label.offset)).toEqual([[0, 0], [0, offset], [0, 0]]);
    expect(markers.map(marker => marker.label.formatter())).toEqual(notes.map(item => item.title));
    expect(markers.map(marker => result.groups.get(marker.name))).toEqual(notes.map(item => [item]));
    expect(result.option.series[0]).toBe(option.series[0]);
  });
  it('keeps overlapping notes in separate wrapped cards with their original dates', () => {
    const ongoing = { ...note, id: 'b', title: 'A long note '.repeat(10), startDate: '2026-09-03', endDate: null };
    const result = addTimelineNotesToChart(option, [note, ongoing], {}, date('2026-09-05'));
    const html = result.option.series[1].markLine.data[0].tooltip.formatter();
    const content = document.createElement('div'); content.innerHTML = html;
    const cards = content.querySelectorAll('.qs-dashboard-echarts-tooltip-card');
    expect(cards).toHaveLength(2);
    expect(result.option.series[1].markLine.data[0].label.formatter()).toBe('2 notes');
    expect(cards[0].textContent).toContain('2026-09-02 – 2026-09-04');
    expect(cards[1].textContent).toContain('2026-09-03 – ongoing');
    expect(cards[1].textContent).toContain(ongoing.title.trim());
    expect(html).toContain('max-width:min(260px, calc(100vw - 32px))');
  });
  it('colors markers and periods without changing label contrast, metrics or mixed-group colors', () => {
    const source = { ...option, textStyle: { color: '#222222' } };
    const colored = { ...note, color: 'purple' as const };
    const overlay = addTimelineNotesToChart(source, [colored]).option.series[1];
    expect(overlay.markLine.data[0].itemStyle.color).toBe(AppColors.Purple);
    expect(overlay.markLine.data[0].lineStyle.color).toBe(AppColors.Purple);
    expect(overlay.markArea.data[0][0].itemStyle.color).toBe(AppColors.Purple);
    expect(overlay.markLine.data[0].label.color).toBe('#222222');
    const mixed = addTimelineNotesToChart(source, [colored, { ...note, id: 'b', color: 'blue' }]);
    expect(mixed.option.series[1].markLine.data[0].itemStyle.color).toBe('#222222');
    expect(mixed.option.series[0]).toBe(source.series[0]);
    const hidden = addTimelineNotesToChart(source, [colored, { ...note, id: 'b', color: 'blue', showOnCharts: false }]);
    expect(hidden.option.series[1].markLine.data[0].itemStyle.color).toBe(AppColors.Purple);
  });
  it('excludes hidden notes from markers, bands, group counts and tooltips without changing readings', () => {
    const hidden = { ...note, id: 'b'.repeat(64), title: 'Hidden private note', showOnCharts: false };
    const result = addTimelineNotesToChart(option, [note, hidden]);
    expect([...result.groups.values()]).toEqual([[note]]);
    expect(result.option.series[1].markLine.data[0].tooltip.formatter()).not.toContain(hidden.title);
    expect(result.option.series[1].markLine.data[0].label.formatter()).toBe(note.title);
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
    expect(result.option.series[1].markLine.data).toHaveLength(1);
    expect(result.option.series[1].markLine.data[0].symbol).toBe('circle');
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
    expect(overlay.markLine.data).toHaveLength(3);
    expect(result.groups.get(overlay.markLine.data[2].name)).toEqual([first, second]);
    expect(overlay.markLine.data[2].xAxis).toBe(date('2026-09-07'));
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
