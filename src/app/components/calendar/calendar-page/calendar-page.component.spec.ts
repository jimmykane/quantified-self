import { Component, Input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ActivityTypes,
  DataAscent,
  DataDescent,
  DataDistance,
  DataDuration,
  DaysOfTheWeek,
  type EventInterface,
} from '@sports-alliance/sports-lib';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import type { TimelineNote } from '@shared/timeline-notes';
import { AppTimelineNotesService } from '../../../services/app.timeline-notes.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import type { CalendarDayDetailsData } from '../calendar-day-details/calendar-day-details.component';
import { AppUserService } from '../../../services/app.user.service';
import { ActivityCalendarService } from '../../../services/activity-calendar.service';
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
import { ActivityRangeTableSectionComponent } from '../../event-table/activity-range-table-section.component';
import { CalendarPageComponent } from './calendar-page.component';

@Component({
  selector: 'app-activity-range-table-section',
  standalone: true,
  template: '',
})
class ActivityRangeTableSectionStubComponent {
  @Input() user: unknown;
  @Input() range: { startMs: number; endExclusiveMs: number } | null = null;
  @Input() heading = '';
  @Input() periodLabel = '';
}

describe('CalendarPageComponent', () => {
  const user = {
    uid: 'user-1',
    settings: {
      unitSettings: { startOfTheWeek: DaysOfTheWeek.Monday },
      summariesSettings: {
        removeAscentForEventTypes: [ActivityTypes.Cycling],
        removeDescentForEventTypes: [ActivityTypes.Cycling],
      },
    },
  };
  let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let navigate: ReturnType<typeof vi.fn>;
  let watchEvents: ReturnType<typeof vi.fn>;
  let openBottomSheet: ReturnType<typeof vi.fn>;
  let dismissed: Subject<string | undefined>;
  const note: TimelineNote = { id: 'a'.repeat(64), category: 'travel', title: 'A trip', startDate: '2026-08-04', endDate: '2026-08-05', timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
  const notesService = { uid: signal<string | null>('user-1'), showOnCharts: signal(true), changes$: new Subject<void>(), loadRange: vi.fn(), invalidate: vi.fn(), isOwner: (uid: string) => notesService.uid() === uid };
  const haptics = { selection: vi.fn() };
  const dialogs = { open: vi.fn() };
  let dayDetailsNavigation: {
    restorationFor: ReturnType<typeof vi.fn>;
    consumeRestoration: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    queryParams = new BehaviorSubject(convertToParamMap({ view: 'month', date: '2026-08-03' }));
    navigate = vi.fn().mockResolvedValue(true);
    watchEvents = vi.fn().mockReturnValue(of([createEvent()]));
    dismissed = new Subject();
    openBottomSheet = vi.fn().mockReturnValue({ afterDismissed: () => dismissed });
    notesService.uid.set('user-1'); notesService.showOnCharts.set(true);
    notesService.loadRange.mockReset().mockResolvedValue({ notes: [], incomplete: null });
    notesService.invalidate.mockImplementation(() => notesService.changes$.next());
    haptics.selection.mockClear(); dialogs.open.mockClear();
    dayDetailsNavigation = {
      restorationFor: vi.fn().mockReturnValue(null),
      consumeRestoration: vi.fn().mockReturnValue(true),
    };
    await TestBed.configureTestingModule({
      imports: [CalendarPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: {
          snapshot: { queryParamMap: queryParams.value },
          queryParamMap: queryParams.asObservable(),
        } },
        { provide: AppUserService, useValue: { user: signal(user), user$: of(user) } },
        { provide: ActivityCalendarService, useValue: { watchEvents } },
        { provide: CalendarDayDetailsNavigationService, useValue: dayDetailsNavigation },
        { provide: AppTimelineNotesService, useValue: notesService },
        { provide: AppHapticsService, useValue: haptics },
        { provide: MatDialog, useValue: dialogs },
      ],
    }).overrideComponent(CalendarPageComponent, {
      remove: { imports: [ActivityRangeTableSectionComponent] },
      add: { imports: [ActivityRangeTableSectionStubComponent] },
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(navigate);
    vi.spyOn(MatBottomSheet.prototype, 'open').mockImplementation(openBottomSheet);
    vi.spyOn(MatDialog.prototype, 'open').mockImplementation(dialogs.open);
  });

  it('loads the visible month independently and renders its activity', async () => {
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(watchEvents).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('#calendar-page-title')?.textContent).toContain('Calendar');
    expect(fixture.nativeElement.querySelector('.qs-page-header__leading-icon')?.textContent?.trim())
      .toBe('calendar_month');
    expect(fixture.nativeElement.querySelector('.calendar-progress-slot')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-day-button')).toHaveLength(1);
    const summaryMetrics = [...fixture.nativeElement.querySelectorAll('.calendar-period-summary-metric')]
      .map((metric: HTMLElement) => ({
        label: metric.querySelector('.calendar-period-summary-label span')?.textContent?.trim(),
        value: metric.querySelector('.calendar-period-summary-value')?.textContent?.trim(),
      }));
    expect(summaryMetrics).toEqual([
      { label: 'Distance', value: '10.00 Km' },
      { label: 'Duration', value: '1h' },
      { label: 'Ascent', value: '450 m' },
    ]);
    expect(fixture.nativeElement.textContent).toContain('August 2026');
  });

  it('renders twelve months when the URL selects the yearly view', async () => {
    queryParams.next(convertToParamMap({ view: 'year', date: '2026-08-03' }));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-month')).toHaveLength(12);
  });

  it('passes an exact primary range to the reusable activity table section', async () => {
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const section = fixture.debugElement.query(By.directive(ActivityRangeTableSectionStubComponent))
      .componentInstance as ActivityRangeTableSectionStubComponent;
    expect(new Date(section.range?.startMs || 0)).toEqual(new Date(2026, 7, 1));
    expect(new Date(section.range?.endExclusiveMs || 0)).toEqual(new Date(2026, 8, 1));

    queryParams.next(convertToParamMap({ view: 'week', date: '2026-08-03' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(new Date(section.range?.startMs || 0)).toEqual(new Date(2026, 7, 3));
    expect(new Date(section.range?.endExclusiveMs || 0)).toEqual(new Date(2026, 7, 10));
  });

  it('renders duration-based family bars with all positive recorded totals', async () => {
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.calendar-volume-toggle')).toBeNull();
    expect(fixture.nativeElement.querySelector('#calendar-family-volume-title')?.textContent?.trim())
      .toBe('Activities');
    const infoButton = fixture.debugElement.query(By.css('.calendar-family-volume-info-button'));
    expect(infoButton.nativeElement.getAttribute('aria-label')).toBe('How activity bars are calculated');
    expect(infoButton.injector.get(MatTooltip).message).toBe(fixture.componentInstance.familyVolumeTooltip);
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-heading')?.textContent)
      .toContain('volume by duration');
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-copy strong')?.textContent?.trim())
      .toBe('Running');
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-value')?.textContent?.trim()).toBe('1h');
    expect((fixture.nativeElement.querySelector('.calendar-family-volume-fill') as HTMLElement)?.style.width)
      .toBe('100%');
    const recordedTotals = [...fixture.nativeElement.querySelectorAll('.calendar-family-volume-stat')]
      .map((stat: HTMLElement) => stat.getAttribute('aria-label'));
    expect(recordedTotals).toEqual([
      'Duration 1h',
      'Distance 10.00 Km',
      'Ascent 450 m',
      'Descent 420 m',
    ]);
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-stat--bar-metric')
      ?.getAttribute('aria-label')).toBe('Duration 1h');
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-track')?.getAttribute('role'))
      .toBe('progressbar');
  });

  it('shows only positive recorded totals beneath each sport-family bar', async () => {
    watchEvents.mockReturnValue(of([createEvent(
      new Date(2026, 7, 3, 8),
      ActivityTypes.Running,
      {
        [DataDistance.type]: null,
        [DataAscent.type]: 0,
        [DataDescent.type]: null,
      },
    )]));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const recordedTotals = [...fixture.nativeElement.querySelectorAll('.calendar-family-volume-stat')]
      .map((stat: HTMLElement) => stat.getAttribute('aria-label'));
    expect(recordedTotals).toEqual(['Duration 1h']);
  });

  it('omits alpine-ski ascent while retaining its recorded descent', async () => {
    watchEvents.mockReturnValue(of([createEvent(new Date(2026, 7, 3, 8), ActivityTypes.AlpineSki)]));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const recordedTotals = [...fixture.nativeElement.querySelectorAll('.calendar-family-volume-stat')]
      .map((stat: HTMLElement) => stat.getAttribute('aria-label'));
    expect(recordedTotals).toEqual([
      'Duration 1h',
      'Distance 10.00 Km',
      'Descent 420 m',
    ]);
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-value')?.textContent?.trim()).toBe('1h');
  });

  it('applies the user summary exclusions to family elevation details', async () => {
    watchEvents.mockReturnValue(of([createEvent(new Date(2026, 7, 3, 8), ActivityTypes.Cycling)]));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const recordedTotals = [...fixture.nativeElement.querySelectorAll('.calendar-family-volume-stat')]
      .map((stat: HTMLElement) => stat.getAttribute('aria-label'));
    expect(recordedTotals).toEqual([
      'Duration 1h',
      'Distance 10.00 Km',
    ]);
  });

  it('pages by the selected view and keeps state in query parameters', () => {
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();

    fixture.componentInstance.navigatePeriod(1);

    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({
      queryParams: { view: 'month', date: '2026-09-03' },
      queryParamsHandling: 'merge',
    }));
  });

  it('provides compact and labeled Material actions for returning to today', () => {
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();

    const desktopButton = fixture.nativeElement.querySelector('.calendar-today-button--desktop');
    const mobileButton = fixture.nativeElement.querySelector('.calendar-today-button--mobile');

    expect(desktopButton?.textContent).toContain('Today');
    expect(mobileButton?.getAttribute('aria-label')).toBe('Go to today');
    expect(mobileButton?.querySelector('mat-icon')?.textContent).toContain('today');
  });

  it('opens Material day details for an activity day', async () => {
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const componentBottomSheet = (fixture.componentInstance as unknown as {
      bottomSheet: MatBottomSheet;
    }).bottomSheet;
    const componentOpen = vi.spyOn(componentBottomSheet, 'open').mockImplementation(openBottomSheet);

    const activityDay = fixture.componentInstance.calendarModel().months[0].days
      .find(day => day.eventCount > 0);
    fixture.componentInstance.openDay(activityDay);

    expect(componentOpen).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user-1',
        unitSettings: user.settings.unitSettings,
        summariesSettings: user.settings.summariesSettings,
      }),
    }));
  });

  it('reopens day details after returning from an event route', async () => {
    const restoration = { sourceUrl: '/', dateKey: '2026-08-03' };
    dayDetailsNavigation.restorationFor.mockReturnValue(restoration);
    const fixture = TestBed.createComponent(CalendarPageComponent);
    const componentBottomSheet = (fixture.componentInstance as unknown as {
      bottomSheet: MatBottomSheet;
    }).bottomSheet;
    vi.spyOn(componentBottomSheet, 'open').mockImplementation(openBottomSheet);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dayDetailsNavigation.consumeRestoration).toHaveBeenCalledWith(restoration);
    expect(openBottomSheet).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      data: expect.objectContaining({ day: expect.objectContaining({ dateKey: '2026-08-03' }) }),
    }));
  });

  it('shows a retryable error state', async () => {
    watchEvents.mockReturnValue(throwError(() => new Error('offline')));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
  });
  it('loads the visible grid and opens notes on days without activities using the shared manager', async () => {
    notesService.loadRange.mockResolvedValue({ notes: [note], incomplete: null });
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.notesByDate().size).toBe(2));
    expect(notesService.loadRange).toHaveBeenCalledWith('user-1', { startDate: '2026-07-27', endDate: '2026-09-06' });
    const day = fixture.componentInstance.calendarModel().months[0].days.find(day => day.dateKey === note.startDate)!;
    fixture.componentInstance.openDay(day);
    const data = openBottomSheet.mock.calls.at(-1)?.[1].data as CalendarDayDetailsData;
    expect(data.timelineNotes?.()).toEqual([note]);
    expect(day.eventCount).toBe(0);
    dismissed.next(note.id);
    expect(dialogs.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: { uid: 'user-1', notes: [note] } }));
    expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('clears an open sheet on account change and ignores a stale note selection', async () => {
    notesService.loadRange.mockResolvedValue({ notes: [note], incomplete: null });
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.notesByDate().size).toBe(2));
    fixture.componentInstance.openDay(fixture.componentInstance.calendarModel().months[0].days.find(day => day.dateKey === note.startDate)!);
    const data = openBottomSheet.mock.calls.at(-1)?.[1].data as CalendarDayDetailsData;
    notesService.uid.set('another-owner'); fixture.detectChanges();
    expect(data.timelineNotes?.()).toEqual([]);
    dismissed.next(note.id);
    expect(dialogs.open).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('keeps notes available when activities fail and does not hide activities when notes fail', async () => {
    watchEvents.mockReturnValue(throwError(() => new Error('offline')));
    notesService.loadRange.mockResolvedValue({ notes: [note], incomplete: 'records' });
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.notesByDate().size).toBe(2));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-note-indicator')).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('Some notes not shown');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.calendar-status-announcement')).toBeNull();
    notesService.loadRange.mockRejectedValue(new Error('notes unavailable'));
    watchEvents.mockReturnValue(of([createEvent()]));
    fixture.componentInstance.retry(); notesService.changes$.next();
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Retry notes');
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-day-button')).toHaveLength(1);
  });

  it('shows the selected month empty state when only an adjacent grid day has an activity', async () => {
    watchEvents.mockReturnValue(of([createEvent(new Date(2026, 8, 1, 8))]));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.hasEvents()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('No activities in August 2026');
    expect(fixture.nativeElement.querySelector('.calendar-status-announcement')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.calendar-status:not(.calendar-status--error)')).toBeNull();
  });

  it('refreshes the today marker when the window regains focus', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 7, 3, 10));
      watchEvents.mockReturnValue(of([]));
      const fixture = TestBed.createComponent(CalendarPageComponent);
      fixture.detectChanges();

      expect(fixture.componentInstance.calendarModel().months[0].days
        .find(day => day.dateKey === '2026-08-03')?.isToday).toBe(true);

      vi.setSystemTime(new Date(2026, 7, 4, 10));
      fixture.componentInstance.refreshToday();

      expect(fixture.componentInstance.calendarModel().months[0].days
        .find(day => day.dateKey === '2026-08-03')?.isToday).toBe(false);
      expect(fixture.componentInstance.calendarModel().months[0].days
        .find(day => day.dateKey === '2026-08-04')?.isToday).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('extends ongoing notes to today when a background tab becomes visible after midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    try {
      vi.setSystemTime(new Date('2026-08-04T12:00:00Z'));
      visibility.mockReturnValue('visible');
      notesService.loadRange.mockResolvedValue({ notes: [{ ...note, endDate: null }], incomplete: null });
      const fixture = TestBed.createComponent(CalendarPageComponent);
      fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
      await vi.waitFor(() => expect(fixture.componentInstance.notesByDate().has('2026-08-04')).toBe(true));
      expect(fixture.componentInstance.notesByDate().has('2026-08-05')).toBe(false);

      vi.setSystemTime(new Date('2026-08-05T12:00:00Z'));
      visibility.mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges(); await fixture.whenStable();
      expect(fixture.componentInstance.notesByDate().has('2026-08-05')).toBe(false);

      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
      await vi.waitFor(() => expect(fixture.componentInstance.notesByDate().has('2026-08-05')).toBe(true));
      expect(fixture.componentInstance.notesByDate().has('2026-08-06')).toBe(false);
    } finally {
      visibility.mockRestore();
      vi.useRealTimers();
    }
  });
});

function createEvent(
  startDate = new Date(2026, 7, 3, 8),
  activityType = ActivityTypes.Running,
  statOverrides: Partial<Record<string, number | null>> = {},
): EventInterface {
  const statValues: Record<string, number | null> = {
    [DataDuration.type]: 3600,
    [DataDistance.type]: 10_000,
    [DataAscent.type]: 450,
    [DataDescent.type]: 420,
    ...statOverrides,
  };
  return {
    name: 'Morning run',
    startDate,
    getID: () => 'event-1',
    getActivityTypesAsArray: () => [activityType],
    getActivityTypesAsString: () => activityType,
    getStat: (type: string) => statValues[type] === undefined || statValues[type] === null
      ? null
      : { getValue: () => statValues[type] },
  } as unknown as EventInterface;
}
