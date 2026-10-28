import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it, vi } from 'vitest';
import { healthChartSourceChoice } from '../../../helpers/chart-source.helper';
import { buildNoteComparisonRows, comparisonValueText } from '../../../helpers/timeline-note-comparison.helper';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { buildHealthNoteComparisonExample } from '../../public-seo/health-preview.data';
import { ChartSourcePickerComponent } from '../chart-source-picker/chart-source-picker.component';
import { NoteComparisonSummaryComponent } from './note-comparison-summary.component';

describe('shared note comparison summary', () => {
  async function render() {
    const haptics = { selection: vi.fn() }, example = buildHealthNoteComparisonExample();
    const rows = buildNoteComparisonRows(example.series, example.window, example.complete).map(row => ({ ...row,
      choices: row.choices.map(healthChartSourceChoice), beforeText: comparisonValueText(row.metricId, row.before),
      afterText: comparisonValueText(row.metricId, row.after), differenceText: comparisonValueText(row.metricId, row.difference, null, true) }));
    await TestBed.configureTestingModule({ imports: [NoteComparisonSummaryComponent], providers: [
      { provide: AppHapticsService, useValue: haptics },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(NoteComparisonSummaryComponent);
    fixture.componentRef.setInput('rows', rows); fixture.componentRef.setInput('days', 7);
    fixture.componentRef.setInput('summaryId', 'note-summary'); fixture.componentRef.setInput('scopeKey', 'owner:note');
    fixture.detectChanges();
    return { fixture, rows, host: fixture.nativeElement as HTMLElement, haptics };
  }
  it('shows three precomputed differences, sources and coverage with a neutral rail and collapsed medians', async () => {
    const { host, rows, haptics } = await render();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('3 of 3 metrics comparable · 7 days on each side');
    expect(host.querySelector('section')?.getAttribute('data-tone')).toBe('neutral');
    expect(host.querySelectorAll('.comparison-change')).toHaveLength(3);
    for (const [index, element] of Array.from(host.querySelectorAll('.comparison-change')).entries()) {
      expect(element.textContent).toContain(rows[index].differenceText);
      expect(element.textContent).toContain('Suunto');
      expect(element.textContent).toContain('Before 7/7 · After 7/7');
      expect(element.closest('[hidden]')).toBeNull();
    }
    expect(host.querySelector<HTMLElement>('#note-summary-details')?.hidden).toBe(true);
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('reveals the full before/after table without changing calculations or source choices', async () => {
    const { fixture, host, rows, haptics } = await render();
    host.querySelector<HTMLButtonElement>('[aria-controls="note-summary-details"]')!.click(); fixture.detectChanges();
    expect(host.querySelector<HTMLElement>('#note-summary-details')?.hidden).toBe(false);
    expect(host.querySelectorAll('tbody tr')).toHaveLength(3);
    for (const [index, element] of Array.from(host.querySelectorAll('tbody tr')).entries()) {
      expect(element.textContent).toContain(rows[index].beforeText); expect(element.textContent).toContain(rows[index].afterText);
    }
    expect(fixture.componentInstance.rows()).toBe(rows); expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('forwards source selections to the owner without duplicate feedback, and disables pickers while loading', async () => {
    const { fixture, haptics } = await render();
    const selected = vi.fn(); fixture.componentInstance.sourceSelected.subscribe(selected);
    const picker = fixture.debugElement.query(By.directive(ChartSourcePickerComponent)).componentInstance as ChartSourcePickerComponent;
    picker.selected.emit('source-choice');
    expect(selected).toHaveBeenCalledWith({ metric: 'sleep_duration', key: 'source-choice' });
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.componentRef.setInput('disabled', true); fixture.detectChanges(); expect(picker.disabled()).toBe(true);
  });
  it('keeps withheld differences explicit without assigning a clinical or good/bad tone', async () => {
    const { fixture, rows, host, haptics } = await render();
    fixture.componentRef.setInput('rows', rows.map(row => ({ ...row, difference: null, differenceText: '—', reason: 'Too few same-source days' })));
    fixture.detectChanges();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('0 of 3 metrics comparable');
    expect(host.querySelector('.comparison-changes')?.textContent).toContain('Too few same-source days');
    for (const state of ['updating', 'failed']) {
      fixture.componentRef.setInput('state', state); fixture.detectChanges();
      expect(host.querySelector('[role="status"]')?.textContent).toContain('Differences withheld');
      expect(host.querySelector('section')?.getAttribute('data-tone')).toBe('neutral');
    }
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('resets the shared disclosure when the owner/note scope changes', async () => {
    const { fixture, host, haptics } = await render();
    host.querySelector<HTMLButtonElement>('button')!.click(); fixture.detectChanges();
    fixture.componentRef.setInput('scopeKey', 'different-owner:different-note'); fixture.detectChanges();
    expect(host.querySelector<HTMLElement>('#note-summary-details')?.hidden).toBe(true);
    expect(haptics.selection).toHaveBeenCalledOnce();
  });
});
