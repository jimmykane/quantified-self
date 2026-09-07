import { describe, expect, it, vi } from 'vitest';
import { addTimelineNotesToChart, groupTimelineNotes, TimelineNotesChartBinding } from './timeline-notes-chart.helper';
import type { TimelineNote } from '@shared/timeline-notes';
const date = (day: string) => Date.parse(`${day}T00:00:00Z`);
const note: TimelineNote = { id: 'a'.repeat(64), category: 'sickness', title: '<script>private</script>', startDate: '2026-09-02', endDate: '2026-09-04', timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
const option = { xAxis: { type: 'time', min: date('2026-09-01'), max: date('2026-09-10') }, yAxis: { min: 0 },
  series: [{ name: 'HR', type: 'line', data: [[date('2026-09-01'), 65], [date('2026-09-03'), null]], markArea: { data: [[{ yAxis: 60 }, { yAxis: 70 }]] } }] };
describe('timeline chart overlays', () => {
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
  it('does nothing for empty, unannotated and non-date charts', () => {
    expect(addTimelineNotesToChart(option, []).option).toBe(option);
    expect(addTimelineNotesToChart({ series: [] }, [note]).range).toBeNull();
    expect(addTimelineNotesToChart({ xAxis: { type: 'value' }, series: [{ data: [1] }] }, [note]).range).toBeNull();
  });
  it('annotates both Form axes and releases click handlers and range registrations', () => {
    const result = addTimelineNotesToChart({ ...option, xAxis: [option.xAxis, option.xAxis], series: [option.series[0], { ...option.series[0], xAxisIndex: 1, yAxisIndex: 1 }] }, [note]);
    expect(result.option.series).toHaveLength(4);
    const chart = { on: vi.fn(), off: vi.fn() };
    const context = { notes: [note], select: vi.fn(), reportRange: vi.fn() };
    const binding = new TimelineNotesChartBinding(); binding.set(context); binding.apply(chart as never, option);
    chart.on.mock.calls[0][1]({ name: 'timeline-note-0-0', componentType: 'markLine' });
    expect(context.select).toHaveBeenCalledWith([note]);
    binding.dispose(); expect(chart.off).toHaveBeenCalledOnce(); expect(context.reportRange).toHaveBeenLastCalledWith(binding, null);
  });
});
