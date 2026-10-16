import { Component, Input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { AppThemes } from '@sports-alliance/sports-lib';
import { BehaviorSubject, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineNote } from '@shared/timeline-notes';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { addComparisonDays, noteComparisonWindow } from '../../helpers/timeline-note-comparison.helper';
import type { HealthWorkspaceSeries } from '../../helpers/health-workspace.helper';
import { AppTimelineNotesService } from '../../services/app.timeline-notes.service';
import { TimelineNoteComparisonService } from '../../services/timeline-note-comparison.service';
import { TimelineNoteComparisonNavigationService } from '../../services/timeline-note-comparison-navigation.service';
import { HealthMetricQueryService } from '../../services/health-metric-query.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { HealthMetricSeriesChartComponent } from '../health/health-metric-series-chart.component';
import { NoteComparisonSummaryComponent } from '../shared/note-comparison-summary/note-comparison-summary.component';
import { By } from '@angular/platform-browser';
import { TimelineNoteComparisonPageComponent } from './timeline-note-comparison-page.component';

@Component({ selector: 'app-health-metric-series-chart', standalone: true, template: '' })
class ChartStub {
  @Input() model: unknown; @Input() startTimeMs: number; @Input() endTimeMs: number;
  @Input() darkTheme: boolean; @Input() unitSettings: unknown; @Input() comparisonWindow: unknown;
  @Input() statusDescription: string;
}
const now = Date.parse('2026-10-15T10:00:00Z');
const note: TimelineNote = { id: 'a'.repeat(64), title: 'Stopped late coffee', details: '<b>Private note</b>',
  category: 'other', startDate: '2026-09-30', endDate: null, timeZone: 'Europe/Helsinki', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
function readings(id: string, metricId: string, variant: string): HealthWorkspaceSeries {
  return { id, metricId, provider: 'SuuntoApp', providerLabel: 'Suunto', sourceLabel: 'Suunto', accountLabel: null,
    semanticLabel: variant, semanticVariant: variant, aggregation: 'average', origin: 'provider_summary', recordingMethod: 'provider_calculated',
    unit: metricId === 'sleep_duration' ? 'second' : 'ms', normalizationStatus: 'canonical', nativeOnly: false,
    valueType: 'number', chartKind: 'line', sampleBased: false, deviceLabel: null, coverageText: '', freshnessText: '', hasConflict: false,
    points: Array.from({ length: 29 }, (_, i) => { const calendarDate = addComparisonDays(note.startDate, i - 14);
      return { timestampMs: Date.parse(`${calendarDate}T08:00:00Z`), calendarDate,
        value: metricId === 'sleep_duration' ? 26_640 : i < 14 ? 55 : 59, qualityCode: null }; }) } as HealthWorkspaceSeries;
}
describe('Timeline note comparison page', () => {
  const uid = signal<string | null>('owner');
  const params = new BehaviorSubject(convertToParamMap({ noteId: note.id }));
  const notes = { uid, isOwner: (id: string) => uid() === id, get: vi.fn(), changes$: new Subject<void>() };
  const comparisons = { load: vi.fn() }, queries = { invalidate: vi.fn() }, navigation = { returnToNotes: vi.fn() };
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() }, dialogs = { open: vi.fn() };
  const units = signal(normalizeUserUnitSettings({}));
  const flush = async (fixture: ReturnType<typeof TestBed.createComponent<TimelineNoteComparisonPageComponent>>) => {
    for (let i = 0; i < 8; i++) { fixture.detectChanges(); TestBed.flushEffects(); await Promise.resolve(); }
    fixture.detectChanges();
  };
  beforeEach(() => {
    vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(now); uid.set('owner'); params.next(convertToParamMap({ noteId: note.id }));
    notes.get.mockImplementation(async owner => owner === 'owner' ? note : null);
    comparisons.load.mockImplementation(async (_uid, selected, days) => ({ window: noteComparisonWindow(selected, days, now),
      series: [readings('sleep', 'sleep_duration', 'session_duration'), readings('hrv', 'heart_rate_variability', 'overnight_average'),
        readings('other-hrv', 'heart_rate_variability', 'sleep_overnight_hrv'), readings('resting', 'resting_heart_rate', 'daily_resting')],
      complete: { sleep_duration: true, heart_rate_variability: true, resting_heart_rate: true }, notices: [] }));
    TestBed.configureTestingModule({ imports: [TimelineNoteComparisonPageComponent], providers: [
      { provide: ActivatedRoute, useValue: { paramMap: params, snapshot: { paramMap: params.value } } },
      { provide: AppTimelineNotesService, useValue: notes }, { provide: TimelineNoteComparisonService, useValue: comparisons },
      { provide: HealthMetricQueryService, useValue: queries }, { provide: TimelineNoteComparisonNavigationService, useValue: navigation },
      { provide: AppHapticsService, useValue: haptics }, { provide: MatDialog, useValue: dialogs },
      { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Normal) } },
      { provide: AppUserSettingsQueryService, useValue: { unitSettings: units } },
    ] }).overrideComponent(TimelineNoteComparisonPageComponent, {
      remove: { imports: [HealthMetricSeriesChartComponent] }, add: { imports: [ChartStub] },
    });
  });
  it('renders the shared header, canonical metrics, source choices and explicit private text without saving or initial feedback', async () => {
    const fixture = TestBed.createComponent(TimelineNoteComparisonPageComponent); await flush(fixture);
    expect(fixture.nativeElement.querySelector('main').classList).toContain('qs-workspace-page');
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(fixture.nativeElement.textContent).toContain('14/14 nights');
    expect(fixture.nativeElement.textContent).toContain('07h 24m');
    expect(fixture.nativeElement.querySelector('.comparison-details b')).toBeNull();
    expect(fixture.nativeElement.querySelector('.comparison-details').textContent).toBe(note.details);
    expect(fixture.componentInstance.chart().window.anchor).toBe(note.startDate);
    expect(haptics.selection).not.toHaveBeenCalled(); expect(queries.invalidate).not.toHaveBeenCalled();
  });
  it('keeps metric and source selection local, retains the source across ranges and rejects unchanged actions', async () => {
    const fixture = TestBed.createComponent(TimelineNoteComparisonPageComponent); await flush(fixture);
    const component = fixture.componentInstance;
    component.chooseSource('heart_rate_variability', 'other-hrv'); component.chooseSource('heart_rate_variability', 'other-hrv');
    component.chooseMetric('sleep_duration'); component.chooseMetric('sleep_duration');
    expect(haptics.selection).toHaveBeenCalledTimes(2); expect(comparisons.load).toHaveBeenCalledOnce();
    component.chooseWindow(28); await flush(fixture);
    expect(component.rows().every(row => row.difference === null)).toBe(true);
    expect(component.selectedSources().heart_rate_variability).toBe('other-hrv');
    expect(fixture.nativeElement.textContent).toContain('after window is still in progress');
    component.chooseWindow(28); expect(haptics.selection).toHaveBeenCalledTimes(3);
  });
  it('uses the same neutral summary as the public example and forwards source choices without changing its chart/calculations', async () => {
    const fixture = TestBed.createComponent(TimelineNoteComparisonPageComponent); await flush(fixture);
    const component = fixture.componentInstance;
    const summary = fixture.debugElement.query(By.directive(NoteComparisonSummaryComponent)).componentInstance as NoteComparisonSummaryComponent;
    expect(summary.rows()).toBe(component.rows()); expect(summary.days()).toBe(14);
    expect(summary.state()).toBe('ready'); expect(summary.headingLevel()).toBe(2);
    const details = fixture.nativeElement.querySelector('#note-comparison-summary-details') as HTMLElement;
    expect(details.hidden).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('.comparison-change')).toHaveLength(3);
    fixture.nativeElement.querySelector('[aria-controls="note-comparison-summary-details"]').click(); fixture.detectChanges();
    expect(details.hidden).toBe(false);
    expect(fixture.nativeElement.querySelector('app-health-metric-series-chart').closest('[hidden]')).toBeNull();
    const medians = component.rows().map(row => [row.before, row.after]);
    summary.sourceSelected.emit({ metric: 'heart_rate_variability', key: 'other-hrv' }); await flush(fixture);
    expect(component.selectedSources().heart_rate_variability).toBe('other-hrv');
    expect(component.rows().map(row => [row.before, row.after])).toEqual(medians);
    expect(comparisons.load).toHaveBeenCalledOnce(); expect(haptics.selection).toHaveBeenCalledTimes(2);
  });
  it('withholds sparse differences in chart accessibility text as well as the metric table', async () => {
    comparisons.load.mockImplementationOnce(async (_uid, selected, days) => {
      const series = readings('hrv', 'heart_rate_variability', 'overnight_average');
      series.points = [series.points[0], series.points.at(-1)!];
      return { window: noteComparisonWindow(selected, days, now), series: [series],
        complete: { sleep_duration: true, heart_rate_variability: true, resting_heart_rate: true }, notices: [] };
    });
    const fixture = TestBed.createComponent(TimelineNoteComparisonPageComponent); await flush(fixture);
    expect(fixture.componentInstance.rows().every(row => row.difference === null)).toBe(true);
    expect(fixture.componentInstance.chart().model.twoReadingComparisonText).toBeNull();
    expect(fixture.componentInstance.chart().model.ariaLabel).not.toContain('Recorded change:');
  });
  it('discloses its method accessibly through the app Material button pattern', async () => {
    const fixture = TestBed.createComponent(TimelineNoteComparisonPageComponent); await flush(fixture);
    const button = fixture.nativeElement.querySelector('[aria-controls="comparison-method"]') as HTMLButtonElement;
    button.click(); fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelector('#comparison-method').hidden).toBe(false);
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('#comparison-method').textContent).toContain('not the latest 14 days');
    expect(fixture.nativeElement.textContent).toContain('You do not need to end it to compare');
  });
  it('explains a note older than stored history, without treating coverage as eligible or changing dates', async () => {
    notes.get.mockResolvedValueOnce({ ...note, startDate: '2026-04-13' });
    comparisons.load.mockImplementationOnce(async (_uid, selected, days) => ({ window: noteComparisonWindow(selected, days, now),
      series: [], complete: { sleep_duration: true, heart_rate_variability: true, resting_heart_rate: true }, notices: [],
      historyStarts: [{ resource: 'sleep', firstDate: '2026-09-12', unavailable: false },
        { resource: 'health', firstDate: null, unavailable: true }] }));
    const fixture = TestBed.createComponent(TimelineNoteComparisonPageComponent); await flush(fixture);
    const copy = fixture.nativeElement.querySelector('.comparison-availability').textContent;
    expect(copy).toContain('after this comparison period'); expect(copy).toContain('Sep');
    expect(copy).toContain('stored history could not be checked');
    expect(copy).toContain('not every metric or every day');
    expect(fixture.nativeElement.querySelector('.comparison-availability a').getAttribute('href')).toBe('/services');
    expect(fixture.componentInstance.window().anchor).toBe('2026-04-13');
    expect(fixture.componentInstance.rows().every(row => row.difference === null)).toBe(true);
  });
  it('clears private content and rejects old responses when the owner changes', async () => {
    const fixture = TestBed.createComponent(TimelineNoteComparisonPageComponent); await flush(fixture);
    let resolve!: (value: unknown) => void;
    comparisons.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fixture.componentInstance.chooseWindow(7); await flush(fixture);
    const oldSignal = comparisons.load.mock.calls.at(-1)[3] as AbortSignal;
    uid.set('other'); await flush(fixture);
    expect(oldSignal.aborted).toBe(true); expect(fixture.componentInstance.note()).toBeNull();
    resolve({}); await flush(fixture);
    expect(fixture.componentInstance.evidence()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain(note.title);
  });
  it('handles missing/deleted notes and load failures explicitly, and retries through the shared cache', async () => {
    notes.get.mockResolvedValueOnce(null);
    const fixture = TestBed.createComponent(TimelineNoteComparisonPageComponent); await flush(fixture);
    expect(fixture.nativeElement.textContent).toContain('no longer exists'); expect(comparisons.load).not.toHaveBeenCalled();
    comparisons.load.mockRejectedValueOnce(new Error('offline')); fixture.componentInstance.retry(); await flush(fixture);
    expect(fixture.nativeElement.textContent).toContain('No result is inferred');
    expect(fixture.componentInstance.rows()).toEqual([]); expect(queries.invalidate).toHaveBeenCalledWith('owner');
  });
  it('retains this owner’s completed chart through refresh without presenting an old difference as current', async () => {
    const fixture = TestBed.createComponent(TimelineNoteComparisonPageComponent); await flush(fixture);
    const previous = fixture.componentInstance.evidence();
    let reject!: (reason: unknown) => void;
    comparisons.load.mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }));
    fixture.componentInstance.retry(); await flush(fixture);
    expect(fixture.componentInstance.evidence()).toBe(previous); expect(fixture.componentInstance.chart()).not.toBeNull();
    expect(fixture.componentInstance.rows().every(row => row.difference === null && row.reason === 'Updating readings')).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Previous readings shown');
    const summary = fixture.debugElement.query(By.directive(NoteComparisonSummaryComponent)).componentInstance as NoteComparisonSummaryComponent;
    expect(summary.state()).toBe('updating'); expect(summary.disabled()).toBe(true);
    reject(new Error('offline')); await flush(fixture);
    expect(fixture.componentInstance.evidence()).toBe(previous);
    expect(fixture.componentInstance.rows().every(row => row.difference === null && row.reason === 'Refresh failed')).toBe(true);
    expect(summary.state()).toBe('failed'); expect(summary.disabled()).toBe(false);
  });
  it('restores the notes manager after returning without changing visibility or note data', async () => {
    const restoreList = { page: 1, cursors: [null, null] }; navigation.returnToNotes.mockResolvedValue({ restoreList });
    const fixture = TestBed.createComponent(TimelineNoteComparisonPageComponent); await flush(fixture);
    await fixture.componentInstance.back();
    expect(dialogs.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: { uid: 'owner', restoreList } }));
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('returns to the comparisons landing page without opening a manager', async () => {
    navigation.returnToNotes.mockResolvedValue({ restoreList: null });
    const fixture = TestBed.createComponent(TimelineNoteComparisonPageComponent); await flush(fixture);
    await fixture.componentInstance.back();
    expect(dialogs.open).not.toHaveBeenCalled(); expect(fixture.componentInstance.returnError()).toBeNull();
    expect(haptics.selection).not.toHaveBeenCalled(); expect(haptics.error).not.toHaveBeenCalled();
  });
  it('does not mislabel a navigation failure as a failed metric refresh', async () => {
    navigation.returnToNotes.mockRejectedValueOnce(new Error('navigation failed'));
    const fixture = TestBed.createComponent(TimelineNoteComparisonPageComponent); await flush(fixture);
    await fixture.componentInstance.back(); fixture.detectChanges();
    expect(fixture.componentInstance.returnError()).toContain('Could not return');
    expect(fixture.componentInstance.rows().every(row => row.difference !== null)).toBe(true);
    expect(haptics.error).toHaveBeenCalledOnce();
    navigation.returnToNotes.mockResolvedValueOnce(null);
    await fixture.componentInstance.back();
    expect(fixture.componentInstance.returnError()).toContain('Could not return');
    expect(haptics.error).toHaveBeenCalledTimes(2);
  });
});
