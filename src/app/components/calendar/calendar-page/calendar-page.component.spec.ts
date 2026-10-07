import { writeFileSync } from 'node:fs';
import { Component, Input, signal } from '@angular/core';
import { ViewportScroller } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, NavigationEnd, provideRouter, Router, Scroll } from '@angular/router';
import {
  ActivityTypes,
  AppThemes,
  DataAscent,
  DataDescent,
  DataDistance,
  DataDuration,
  DaysOfTheWeek,
  type EventInterface,
} from '@sports-alliance/sports-lib';
import { BehaviorSubject, Subject, of, throwError, map } from 'rxjs';
import type { TimelineNote } from '@shared/timeline-notes';
import type { WorkoutStructureV1 } from '@shared/planned-workout';
import { AppTimelineNotesService } from '../../../services/app.timeline-notes.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import type { CalendarDayDetailsResult } from '../calendar-day-details/calendar-day-details.component';
import { AppUserService } from '../../../services/app.user.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { CalendarDayHealthService } from '../../../services/calendar-day-health.service';
import { ActivityCalendarService } from '../../../services/activity-calendar.service';
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
import { TrainingPlansService, type CurrentTrainingScheduleV1 } from '../../../services/training-plans.service';
import { ActivityRangeTableSectionComponent } from '../../event-table/activity-range-table-section.component';
import { CalendarPageComponent } from './calendar-page.component';
import { TrainingImpactService } from '../../../services/training-impact.service';

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
  const planningUserUid = 'planning-user';
  const user = {
    uid: planningUserUid,
    settings: {
      unitSettings: { startOfTheWeek: DaysOfTheWeek.Monday },
      summariesSettings: {
        removeAscentForEventTypes: [ActivityTypes.Cycling],
        removeDescentForEventTypes: [ActivityTypes.Cycling],
      },
    },
  };
  let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let activatedRoute: {
    snapshot: { queryParamMap: ReturnType<typeof convertToParamMap>; paramMap: ReturnType<typeof convertToParamMap>; data: Record<string, unknown> };
    queryParamMap: ReturnType<BehaviorSubject<ReturnType<typeof convertToParamMap>>['asObservable']>;
    paramMap: ReturnType<BehaviorSubject<ReturnType<typeof convertToParamMap>>['asObservable']>;
  };
  let navigate: ReturnType<typeof vi.fn>;
  let watchEvents: ReturnType<typeof vi.fn>;
  let openBottomSheet: ReturnType<typeof vi.fn>;
  let dismissed: Subject<CalendarDayDetailsResult | undefined>;
  const note: TimelineNote = { id: 'a'.repeat(64), category: 'travel', title: 'A trip', startDate: '2026-08-04', endDate: '2026-08-05', timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
  const notesService = { uid: signal<string | null>(planningUserUid), showOnCharts: signal(true), changes$: new Subject<void>(), loadRange: vi.fn(), cachedRange: vi.fn(() => null), invalidate: vi.fn(), isOwner: (uid: string) => notesService.uid() === uid };
  const haptics = { selection: vi.fn() };
  const dialogs = { open: vi.fn() };
  let watchSchedule: ReturnType<typeof vi.fn>;
  let watchWorkoutCompletions: ReturnType<typeof vi.fn>;
  let dayDetailsNavigation: {
    restorationFor: ReturnType<typeof vi.fn>;
    consumeRestoration: ReturnType<typeof vi.fn>;
    workoutDestinationFor: ReturnType<typeof vi.fn>;
    consumeWorkoutDestination: ReturnType<typeof vi.fn>;
    prepareWorkoutDestination: ReturnType<typeof vi.fn>;
    prepareReturn: ReturnType<typeof vi.fn>;
  };
  let pendingDestination: ReturnType<typeof signal<string | null>>;

  beforeEach(async () => {
    queryParams = new BehaviorSubject(convertToParamMap({ view: 'month', date: '2026-08-03' }));
    routeParams = new BehaviorSubject(convertToParamMap({}));
    activatedRoute = {
      snapshot: { queryParamMap: queryParams.value, paramMap: routeParams.value, data: {} },
      queryParamMap: queryParams.asObservable(), paramMap: routeParams.asObservable(),
    };
    navigate = vi.fn().mockResolvedValue(true);
    watchEvents = vi.fn().mockReturnValue(of([createEvent()]));
    dismissed = new Subject();
    openBottomSheet = vi.fn().mockReturnValue({ afterDismissed: () => dismissed });
    notesService.uid.set(planningUserUid); notesService.showOnCharts.set(true);
    notesService.loadRange.mockReset().mockResolvedValue({ notes: [], incomplete: null });
    notesService.invalidate.mockImplementation(() => notesService.changes$.next());
    haptics.selection.mockClear(); dialogs.open.mockClear();
    watchSchedule = vi.fn().mockReturnValue(of(emptySchedule()));
    watchWorkoutCompletions = vi.fn().mockReturnValue(of([]));
    pendingDestination = signal<string | null>(null);
    dayDetailsNavigation = {
      restorationFor: vi.fn().mockReturnValue(null),
      consumeRestoration: vi.fn().mockReturnValue(true),
      workoutDestinationFor: vi.fn().mockImplementation(() => pendingDestination()),
      consumeWorkoutDestination: vi.fn().mockImplementation(() => { pendingDestination.set(null); return true; }),
      prepareWorkoutDestination: vi.fn().mockImplementation((_uid, date) => { pendingDestination.set(date); return true; }),
      prepareReturn: vi.fn().mockReturnValue(true),
    };
    await TestBed.configureTestingModule({
      imports: [CalendarPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: activatedRoute },
        { provide: AppUserService, useValue: { user: signal(user), user$: of(user) } },
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Normal) } },
        { provide: ActivityCalendarService, useValue: { watchEvents, watchSummaryEvents: vi.fn((...args) => watchEvents(...args).pipe(map(events => ({ events, complete: true })))) } },
        { provide: TrainingPlansService, useValue: { watchSchedule, watchWorkoutCompletions, watchCalendarSchedule: vi.fn((...args) => watchSchedule(...args)), watchWorkoutCompletionsForWorkouts: vi.fn((...args) => watchWorkoutCompletions(...args)) } },
        { provide: CalendarDayDetailsNavigationService, useValue: dayDetailsNavigation },
        { provide: CalendarDayHealthService, useValue: { watch: vi.fn(() => of({ sessions: [], hrvSeries: [], derived: null, sleepError: false, hrvError: false, readinessError: false, recoveryError: false })) } },
        { provide: TrainingImpactService, useValue: { watch: vi.fn(() => of({ status: 'private', formPoints: null })) } },
        { provide: AppTimelineNotesService, useValue: notesService },
        { provide: AppHapticsService, useValue: haptics },
        { provide: AppEventColorService, useValue: {
          getActivityColor: vi.fn(), getColorForActivityTypeByActivityTypeGroup: vi.fn(),
        } },
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

  it.each(['week', 'month'] as const)('uses bounded %s readers and keeps failed completion coverage unknown through retry', async view => {
    queryParams.next(convertToParamMap({ view, date: '2026-08-03' }));
    const plans = TestBed.inject(TrainingPlansService);
    const calendar = TestBed.inject(ActivityCalendarService);
    vi.mocked(plans.watchWorkoutCompletionsForWorkouts).mockReturnValueOnce(throwError(() => new Error('failed'))).mockReturnValue(of([]));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(calendar.watchSummaryEvents).toHaveBeenCalled();
    expect(plans.watchCalendarSchedule).toHaveBeenCalledWith(planningUserUid,
      view === 'week' ? '2026-08-03' : '2026-07-27', view === 'week' ? '2026-08-09' : '2026-09-06');
    expect(fixture.componentInstance.prescriptionSummary().remainingCount).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Completion coverage is unavailable');
    const retry = Array.from(fixture.nativeElement.querySelectorAll('button')).find((button: HTMLButtonElement) => button.textContent.includes(`Retry ${view} summary`)) as HTMLButtonElement;
    retry.click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.prescriptionSummary().remainingCount).toBe(0);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });

  it.each(['week', 'month'] as const)('withholds %s completed markers for conflicting links and labels failed completion reads unknown', async view => {
    queryParams.next(convertToParamMap({ view, date: '2026-08-04' }));
    const schedule = trainingSchedule();
    const workout = schedule.workouts.find(workout => workout.id === 'active-workout')!;
    watchSchedule.mockReturnValue(of(schedule));
    const links = new Subject<{ workoutId: string; planId: string | null; workoutRevisionAtLink: number }[]>();
    watchWorkoutCompletions.mockReturnValue(links);
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    links.next([{ workoutId: workout.id, planId: workout.planId, workoutRevisionAtLink: workout.revision }]);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.prescriptionSummary().completedCount).toBe(1);
    expect(fixture.nativeElement.querySelector('.planned-workout-marker--completed')).not.toBeNull();
    links.next([{ workoutId: workout.id, planId: 'wrong-plan', workoutRevisionAtLink: workout.revision }]);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.prescriptionSummary().completedCount).toBeNull();
    expect(fixture.nativeElement.querySelector('.planned-workout-marker--completed')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('completion unknown');
    links.error(new Error('failed'));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.selectedDayPlanned().every(entry => entry.completionKnown === false)).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('completion unknown');
  });

  it.each([['week', false], ['week', true], ['month', false], ['month', true]] as const)('keeps partial %s activity and schedule coverage explicit with observed activities=%s', async (view, observed) => {
    queryParams.next(convertToParamMap({ view, date: '2026-08-03' }));
    const events = new Subject<{ events: EventInterface[]; complete: boolean }>();
    vi.mocked(TestBed.inject(ActivityCalendarService).watchSummaryEvents).mockReturnValue(events);
    watchSchedule.mockReturnValue(of({ ...emptySchedule(), workoutsComplete: false }));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    events.next({ events: observed ? [createEvent()] : [], complete: false });
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const page = fixture.componentInstance;
    expect(page.familyVolumeRows()).toEqual([]);
    expect(page.selectedDayActivities().complete).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Day totals are unknown');
    expect(fixture.nativeElement.textContent).toContain('Only observed workouts are shown');
    expect(fixture.nativeElement.textContent).not.toContain('No completed activities');
    expect(fixture.nativeElement.textContent).not.toContain('No planned workouts for this day');
    expect([...fixture.nativeElement.querySelectorAll('.calendar-day-context-totals strong')].map((element: HTMLElement) => element.textContent))
      .toEqual(['--', '--', '--']);
    const days = [...fixture.nativeElement.querySelectorAll('.activity-calendar-day-button')] as HTMLElement[];
    expect(days.every(day => day.getAttribute('aria-label')?.includes('Activity coverage unknown'))).toBe(true);
    expect(days.every(day => day.getAttribute('aria-label')?.includes('Planned workout coverage unknown'))).toBe(true);
    expect(days.some(day => day.getAttribute('aria-label')?.includes('No activities'))).toBe(false);
    events.next({ events: [], complete: true });
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No completed activities');
  });

  it.each(['week', 'month'] as const)('cancels a late %s read on navigation and clears the new summary while it loads', async view => {
    queryParams.next(convertToParamMap({ view, date: '2026-08-03' }));
    const first = new Subject<{ events: EventInterface[]; complete: boolean }>();
    const second = new Subject<{ events: EventInterface[]; complete: boolean }>();
    vi.mocked(TestBed.inject(ActivityCalendarService).watchSummaryEvents).mockReturnValueOnce(first).mockReturnValueOnce(second);
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    first.next({ events: [createEvent()], complete: true }); fixture.detectChanges();
    queryParams.next(convertToParamMap({ view, date: view === 'month' ? '2026-09-17' : '2026-08-17' })); fixture.detectChanges();
    expect(fixture.componentInstance.prescriptionSummary().recordedCount).toBeNull();
    first.next({ events: [createEvent()], complete: true });
    expect(fixture.componentInstance.eventState().status).toBe('loading');
    second.next({ events: [], complete: true }); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.prescriptionSummary().recordedCount).toBe(0);
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('summarizes only the anchored month while adjoining activities and workouts remain selectable', async () => {
    const schedule = trainingSchedule();
    const recipe = schedule.workouts[0].structure;
    schedule.workouts.push(
      { ...calendarWorkout('skipped', null, recipe), localDate: '2026-08-05', lifecycle: 'skipped' },
      { ...calendarWorkout('before', null, recipe), localDate: '2026-07-31' },
      { ...calendarWorkout('after', null, recipe), localDate: '2026-09-01' },
    );
    watchSchedule.mockReturnValue(of(schedule));
    watchWorkoutCompletions.mockReturnValue(of([{ schemaVersion: 1, workoutId: 'active-workout', planId: 'active-plan',
      provider: 'garmin', matchMethod: 'provider_marker', eventId: 'outside-month', activityId: null,
      sourceSessionIndex: null, activityStartAtMs: new Date(2026, 8, 2).getTime(), scheduledLocalDate: '2026-07-30',
      workoutRevisionAtLink: 1, timing: 'late', linkedAtMs: 1, updatedAtMs: 1 }]));
    watchEvents.mockReturnValue(of([
      { ...createEvent(new Date(2026, 7, 1)), getID: () => 'first' },
      { ...createEvent(new Date(2026, 7, 31, 23, 59)), getID: () => 'last' },
      { ...createEvent(new Date(2026, 6, 31)), getID: () => 'before' },
      { ...createEvent(new Date(2026, 8, 1)), getID: () => 'after' },
    ]));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const page = fixture.componentInstance;
    expect(fixture.nativeElement.querySelector('#calendar-period-summary-title')?.textContent).toBe('Month summary');
    expect(fixture.nativeElement.querySelector('[aria-label="Recorded month volume"]')).toBeTruthy();
    expect(page.prescriptionSummary()).toMatchObject({ period: 'month', recordedCount: 2,
      scheduledCount: 3, completedCount: 1, skippedCount: 1, remainingCount: 1 });
    expect(page.prescriptionSummary().planned?.summary.duration.completeExactSeconds).toBe(3600);
    expect(page.prescriptionSummary().remaining?.summary.duration.completeExactSeconds).toBe(1800);
    expect(page.prescriptionSummary().recordedMetrics.find(metric => metric.label === 'Ascent')?.text).toBe('900 m');
    expect(page.plannedWorkoutsByDate()['2026-07-31'].entries[0].workout.id).toBe('before');
    if (process.env.CALENDAR_PERIOD_QA_DIR) writeFileSync(`${process.env.CALENDAR_PERIOD_QA_DIR}/month.html`,
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="styles.css">${
        Array.from(document.head.querySelectorAll('style')).map(style => style.outerHTML).join('')
      }</head><body>${fixture.nativeElement.outerHTML}</body></html>`);
    const adjoining = page.calendarModel().months[0].days.find(day => day.dateKey === '2026-07-31')!;
    expect(adjoining.eventCount).toBe(1);
    page.openDay(adjoining);
    queryParams.next(convertToParamMap(navigate.mock.calls.at(-1)[1].queryParams));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(page.selectedDay()?.dateKey).toBe('2026-07-31');
    expect(page.prescriptionSummary().recordedCount).toBe(2);
    expect(page.prescriptionSummary().scheduledCount).toBe(3);
    expect(TestBed.inject(TrainingPlansService).watchCalendarSchedule).toHaveBeenCalledOnce();
  });

  it('owns one haptic for an accepted view change and stays silent for unchanged view and hydration', async () => {
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable();
    fixture.componentInstance.selectView('month');
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.componentInstance.selectView('week');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });

  it('selects an adjoining date without changing the month query or anchor', async () => {
    queryParams.next(convertToParamMap({ view: 'month', date: '2026-10-01' }));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const adjacent = fixture.componentInstance.calendarModel().months[0].days.find(day => day.dateKey === '2026-09-28')!;
    fixture.componentInstance.openDay(adjacent);
    expect(navigate.mock.calls.at(-1)[1].queryParams).toEqual({ view: 'month', date: '2026-09-28', anchor: '2026-10-01' });
    queryParams.next(convertToParamMap(navigate.mock.calls.at(-1)[1].queryParams));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.calendarModel().periodLabel).toContain('October');
    expect(fixture.componentInstance.selectedDay()?.dateKey).toBe('2026-09-28');
    expect(watchEvents).toHaveBeenCalledOnce();
  });

  it('pages thirty dates while keeping the selected date separate and the table range exact', async () => {
    queryParams.next(convertToParamMap({ view: '30d', date: '2026-09-16', anchor: '2026-10-01' }));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.calendarModel().months[0].days.filter(day => day.inPrimaryPeriod)).toHaveLength(30);
    expect(fixture.nativeElement.querySelector('.calendar-selected-day.qs-glass-card-panel')).toBeNull();
    expect(fixture.componentInstance.primaryActivityRange()).toEqual({
      startMs: new Date(2026, 8, 2).getTime(), endExclusiveMs: new Date(2026, 9, 2).getTime(),
    });
    fixture.componentInstance.navigatePeriod(-1);
    expect(navigate.mock.calls.at(-1)[1].queryParams).toEqual({ view: '30d', date: '2026-08-17', anchor: '2026-09-01' });
    queryParams.next(convertToParamMap({ view: 'month', date: '2026-09-28', anchor: '2026-10-01' }));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.selectedDay()?.dateKey).toBe('2026-09-28');
  });

  it('loads the visible month independently and renders its activity', async () => {
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(watchEvents).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('#calendar-page-title')?.textContent).toContain('Calendar');
    expect(fixture.nativeElement.querySelector('.calendar-page--calm-month .activity-calendar--calm-month')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.qs-page-header__leading-icon')?.textContent?.trim())
      .toBe('calendar_month');
    expect(fixture.nativeElement.querySelector('.calendar-progress-slot')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-day-button')).toHaveLength(
      fixture.componentInstance.calendarModel().months[0].days.length);
    const summaryMetrics = [...fixture.nativeElement.querySelectorAll('.recorded-metrics > div')]
      .map((metric: HTMLElement) => ({
        label: metric.querySelector('dt')?.textContent?.trim(),
        value: metric.querySelector('dd')?.textContent?.trim(),
      }));
    expect(summaryMetrics).toEqual([
      { label: 'Duration', value: '01h 00m 00s' },
      { label: 'Distance', value: '10.00 Km' },
      { label: 'Ascent', value: '450 m' },
      { label: 'Recorded load', value: 'Unavailable' },
    ]);
    const selectedDayTotals = [...fixture.nativeElement.querySelectorAll('.calendar-selected-day .calendar-day-context-totals > div')]
      .map((metric: HTMLElement) => ({
        label: metric.querySelector('span')?.textContent?.trim(),
        value: metric.querySelector('strong')?.textContent?.trim(),
      }));
    expect(selectedDayTotals).toEqual([
      { label: 'Distance', value: '10.00 Km' }, { label: 'Duration', value: '1h' }, { label: 'Ascent', value: '450 m' },
    ]);
    expect(fixture.nativeElement.textContent).toContain('August 2026');
  });

  it('keeps completed activities visible while a staged restore hides planned workouts', async () => {
    watchSchedule.mockReturnValue(of({ ...trainingSchedule(), restoreUnavailable: true }));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.eventState().status).toBe('ready');
    expect(fixture.componentInstance.plansState().status).toBe('error');
    expect(fixture.componentInstance.plannedWorkoutsByDate()).toEqual({});
  });

  it('shows zero selected-day totals for an empty date without changing month totals', async () => {
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    queryParams.next(convertToParamMap({ view: 'month', date: '2026-08-04' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedDay()?.dateKey).toBe('2026-08-04');
    expect([...fixture.nativeElement.querySelectorAll('.calendar-selected-day .calendar-day-context-totals strong')]
      .map((value: HTMLElement) => value.textContent?.trim())).toEqual(['0.0 m', '0m', '0 m']);
    expect(fixture.nativeElement.querySelector('.recorded-metrics')?.textContent).toContain('10.00 Km');
  });

  it('opens a bounded standalone day with its context and no calendar grid', async () => {
    activatedRoute.snapshot.data = { calendarMode: 'day' };
    activatedRoute.snapshot.paramMap = convertToParamMap({ date: '2026-08-03' });
    routeParams.next(activatedRoute.snapshot.paramMap);
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1#calendar-page-title')?.textContent).toContain('Aug');
    expect(fixture.nativeElement.querySelector('.calendar-page-header')).toBeNull();
    expect(fixture.nativeElement.querySelector('.calendar-day-toolbar a')?.getAttribute('href'))
      .toBe('/calendar?view=month&date=2026-08-03');
    expect(fixture.nativeElement.querySelector('.calendar-day-toolbar a')?.getAttribute('aria-label'))
      .toBe('Back to calendar for this day');
    expect(fixture.nativeElement.querySelector('.calendar-day-toolbar app-timeline-notes-workspace')).toBeTruthy();
    expect(fixture.componentInstance.dayShortTitle()).toContain('Aug');
    expect(fixture.nativeElement.querySelector('.activity-calendar-day-button')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-calendar-day-context')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.calendar-day-context-totals')).toBeNull();
    expect(watchEvents).toHaveBeenCalledWith(user, {
      startMs: new Date(2026, 7, 3).getTime(), endExclusiveMs: new Date(2026, 7, 4).getTime(),
    });
    expect(fixture.componentInstance.timelineNoteRange()).toEqual({ startDate: '2026-08-03', endDate: '2026-08-03' });
    expect(fixture.nativeElement.querySelector('app-activity-range-table-section')).toBeNull();
  });

  it('keeps mode and period on Full day return, including browser Back and Forward', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 7, 15));
    activatedRoute.snapshot.data = { calendarMode: 'day' };
    activatedRoute.snapshot.paramMap = convertToParamMap({ date: '2026-08-03' });
    activatedRoute.snapshot.queryParamMap = convertToParamMap({ calendarView: '30d', calendarAnchor: '2026-08-15' });
    routeParams.next(activatedRoute.snapshot.paramMap); queryParams.next(activatedRoute.snapshot.queryParamMap);
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.calendarBackQuery()).toEqual({ view: '30d', date: '2026-08-03', anchor: '2026-08-15' });
    fixture.componentInstance.navigatePeriod(1);
    expect(navigate).toHaveBeenCalledWith(['/calendar/day', '2026-08-04'], { queryParams: { calendarView: '30d', calendarAnchor: '2026-08-15' } });
    routeParams.next(convertToParamMap({ date: '2026-08-04' })); fixture.detectChanges();
    expect(fixture.componentInstance.calendarBackQuery().date).toBe('2026-08-04');
    routeParams.next(convertToParamMap({ date: '2026-08-03' })); fixture.detectChanges();
    expect(fixture.componentInstance.calendarBackQuery().date).toBe('2026-08-03');
    routeParams.next(convertToParamMap({ date: '2026-09-15' })); fixture.detectChanges();
    expect(fixture.componentInstance.calendarBackQuery().anchor).toBe('2026-09-15');
    vi.useRealTimers();
  });

  it('returns to a grid that visibly includes a day beyond the padded 30-day activity window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 1));
    activatedRoute.snapshot.data = { calendarMode: 'day' };
    activatedRoute.snapshot.paramMap = convertToParamMap({ date: '2026-10-05' });
    activatedRoute.snapshot.queryParamMap = convertToParamMap({ calendarView: '30d', calendarAnchor: '2026-10-01' });
    routeParams.next(activatedRoute.snapshot.paramMap); queryParams.next(activatedRoute.snapshot.queryParamMap);
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.calendarBackQuery()).toEqual({ view: '30d', date: '2026-10-05', anchor: '2026-10-05' });
    vi.useRealTimers();
  });

  it.each([undefined, 'today-sheet'])('restores the dashboard period after a fresh full-day load with surface %s', async surface => {
    const params = { from: 'dashboard', calendarView: '30d', calendarAnchor: '2026-08-15', ...(surface ? { calendarSurface: surface } : {}) };
    activatedRoute.snapshot.data = { calendarMode: 'day' };
    activatedRoute.snapshot.paramMap = convertToParamMap({ date: '2026-08-04' });
    activatedRoute.snapshot.queryParamMap = convertToParamMap(params);
    routeParams.next(activatedRoute.snapshot.paramMap); queryParams.next(activatedRoute.snapshot.queryParamMap);
    const router = TestBed.inject(Router); router.resetConfig([{ path: 'dashboard', children: [] }]);
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    (fixture.nativeElement.querySelector('.calendar-day-back') as HTMLAnchorElement).click();
    expect(dayDetailsNavigation.prepareReturn).toHaveBeenCalledWith('/dashboard', '2026-08-04', surface,
      { view: '30d', anchor: '2026-08-15' });
    await fixture.whenStable();
    fixture.componentInstance.navigatePeriod(1);
    expect(navigate).toHaveBeenCalledWith(['/calendar/day', '2026-08-05'], { queryParams: params });
  });

  it('navigates adjacent day routes and follows the path parameter on Back', async () => {
    activatedRoute.snapshot.data = { calendarMode: 'day' };
    activatedRoute.snapshot.paramMap = convertToParamMap({ date: '2026-08-03' });
    routeParams.next(activatedRoute.snapshot.paramMap);
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    fixture.componentInstance.navigatePeriod(1);
    expect(navigate).toHaveBeenCalledWith(['/calendar/day', '2026-08-04']);
    routeParams.next(convertToParamMap({ date: '2026-08-04' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedDay()?.dateKey).toBe('2026-08-04');
    routeParams.next(convertToParamMap({ date: '2026-08-03' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedDay()?.dateKey).toBe('2026-08-03');
  });

  it('returns to the dashboard only when the full day was opened from its calendar tile', async () => {
    queryParams.next(convertToParamMap({ from: 'dashboard' }));
    activatedRoute.snapshot.queryParamMap = queryParams.value;
    activatedRoute.snapshot.data = { calendarMode: 'day' };
    activatedRoute.snapshot.paramMap = convertToParamMap({ date: '2026-08-03' });
    routeParams.next(activatedRoute.snapshot.paramMap);
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();

    const back = fixture.nativeElement.querySelector('.calendar-day-toolbar a');
    expect(back?.getAttribute('href')).toBe('/dashboard');
    expect(back?.getAttribute('aria-label')).toBe('Back to dashboard');
    expect(back?.textContent).toContain('Dashboard');

    fixture.componentInstance.navigatePeriod(1);
    expect(navigate).toHaveBeenCalledWith(['/calendar/day', '2026-08-04'], {
      queryParams: { from: 'dashboard' },
    });
    routeParams.next(convertToParamMap({ date: '2026-08-04' }));
    fixture.detectChanges();
    expect(back?.getAttribute('href')).toBe('/dashboard');

    queryParams.next(convertToParamMap({}));
    fixture.detectChanges();
    expect(back?.getAttribute('href')).toBe('/calendar?view=month&date=2026-08-04');
  });

  it('reads and exposes planning for any signed-in account while completed activities remain visible', async () => {
    const otherUser = { ...user, uid: 'another-user' };
    watchSchedule.mockReturnValue(of(trainingSchedule()));
    watchWorkoutCompletions.mockReturnValue(of([{ workoutId: 'active-workout' }]));
    Object.assign(TestBed.inject(AppUserService), { user: signal(otherUser), user$: of(otherUser) });
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(TestBed.inject(TrainingPlansService).watchCalendarSchedule).toHaveBeenCalledWith(otherUser.uid, '2026-07-27', '2026-09-06');
    expect(TestBed.inject(TrainingPlansService).watchWorkoutCompletionsForWorkouts).toHaveBeenCalledWith(otherUser.uid, ['active-workout', 'standalone-workout']);
    expect(watchEvents).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.plannedWorkoutsByDate()).not.toEqual({});
    expect(fixture.componentInstance.plannedWorkoutsByDate()['2026-08-04'].entries
      .find(entry => entry.workout.id === 'active-workout')?.completed).toBe(true);
    expect(fixture.nativeElement.querySelector('.planned-workout-marker--completed')?.textContent?.trim()).toBe('task_alt');
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-day-button')).toHaveLength(
      fixture.componentInstance.calendarModel().months[0].days.length);
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
    const recordedTotals = [...fixture.nativeElement.querySelectorAll('.calendar-family-volume > app-activity-calendar-volume-list .calendar-family-volume-stat')]
      .map((stat: HTMLElement) => stat.getAttribute('aria-label'));
    expect(recordedTotals).toEqual([
      'Distance 10.00 Km',
      'Ascent 450 m',
      'Descent 420 m',
    ]);
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-stat--bar-metric')).toBeNull();
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-track')?.getAttribute('role'))
      .toBe('progressbar');
  });

  it('does not repeat the sole duration total beneath a single-activity sport-family bar', async () => {
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

    const recordedTotals = [...fixture.nativeElement.querySelectorAll('.calendar-family-volume > app-activity-calendar-volume-list .calendar-family-volume-stat')]
      .map((stat: HTMLElement) => stat.getAttribute('aria-label'));
    expect(recordedTotals).toEqual([]);
    expect(fixture.nativeElement.querySelector('.calendar-family-volume-value')?.textContent?.trim()).toBe('1h');
  });

  it('omits alpine-ski ascent while retaining its recorded descent', async () => {
    watchEvents.mockReturnValue(of([createEvent(new Date(2026, 7, 3, 8), ActivityTypes.AlpineSki)]));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const recordedTotals = [...fixture.nativeElement.querySelectorAll('.calendar-family-volume > app-activity-calendar-volume-list .calendar-family-volume-stat')]
      .map((stat: HTMLElement) => stat.getAttribute('aria-label'));
    expect(recordedTotals).toEqual([
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

    const recordedTotals = [...fixture.nativeElement.querySelectorAll('.calendar-family-volume > app-activity-calendar-volume-list .calendar-family-volume-stat')]
      .map((stat: HTMLElement) => stat.getAttribute('aria-label'));
    expect(recordedTotals).toEqual([
      'Distance 10.00 Km',
    ]);
  });

  it('pages by the selected view and keeps state in query parameters', () => {
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();

    fixture.componentInstance.navigatePeriod(1);

    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({
      queryParams: expect.objectContaining({ view: 'month', date: '2026-09-03' }),
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

  it('selects an activity day inline and updates the linkable route date', async () => {
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const activityDay = fixture.componentInstance.calendarModel().months[0].days.find(day => day.eventCount > 0)!;
    fixture.componentInstance.openDay(activityDay);
    expect(fixture.componentInstance.selectedDayData()?.day.dateKey).toBe(activityDay.dateKey);
    expect(fixture.nativeElement.querySelector('app-calendar-day-context')).toBeTruthy();
    expect(openBottomSheet).not.toHaveBeenCalled();
  });

  it('writes a shareable URL when selecting the initially highlighted day without a date parameter', async () => {
    queryParams.next(convertToParamMap({ view: 'month' }));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const selected = fixture.componentInstance.selectedDay()!;
    fixture.componentInstance.openDay(selected);
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({
      queryParams: expect.objectContaining({ view: 'month', date: selected.dateKey }),
    }));
  });

  it.each(['week', 'month', 'year'] as const)('keeps the selected day linkable and restores it on Back in %s view', async view => {
    queryParams.next(convertToParamMap({ view, date: '2026-08-03' }));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const next = fixture.componentInstance.calendarModel().months.flatMap(month => month.days)
      .find(day => day.dateKey === '2026-08-04')!;
    fixture.componentInstance.openDay(next);
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ view, date: '2026-08-04' }) }));
    queryParams.next(convertToParamMap({ view, date: '2026-08-04' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedDay()?.dateKey).toBe('2026-08-04');
    queryParams.next(convertToParamMap({ view, date: '2026-08-03' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedDay()?.dateKey).toBe('2026-08-03');
  });

  it('drills from a narrow Year grid into the selected month, even for the already highlighted date', async () => {
    queryParams.next(convertToParamMap({ view: 'year', date: '2026-08-03' }));
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true } as MediaQueryList));
    try {
      const fixture = TestBed.createComponent(CalendarPageComponent);
      fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
      fixture.componentInstance.openDay(fixture.componentInstance.selectedDay()!);
      expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({
        queryParams: expect.objectContaining({ view: 'month', date: '2026-08-03' }),
      }));
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('preserves scroll after a day selection while leaving browser Back restoration to the router', async () => {
    const router = TestBed.inject(Router);
    const routerEvents = new Subject<Scroll>();
    vi.spyOn(router, 'events', 'get').mockReturnValue(routerEvents.asObservable());
    const scroller = TestBed.inject(ViewportScroller);
    vi.spyOn(scroller, 'getScrollPosition').mockReturnValue([0, 420]);
    const restore = vi.spyOn(scroller, 'scrollToPosition').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const day = fixture.componentInstance.calendarModel().months[0].days.find(item => item.dateKey === '2026-08-04')!;
    fixture.componentInstance.openDay(day);
    routerEvents.next(new Scroll(new NavigationEnd(1, '/calendar', '/calendar?view=month&date=2026-08-05'), null, null));
    await Promise.resolve();
    expect(restore).not.toHaveBeenCalled();
    routerEvents.next(new Scroll(new NavigationEnd(2, '/calendar', '/calendar?view=month&date=2026-08-04&anchor=2026-08-03'), null, null));
    await Promise.resolve();
    expect(restore).toHaveBeenCalledWith([0, 420]);
    restore.mockClear();
    fixture.componentInstance.navigatePeriod(1);
    routerEvents.next(new Scroll(new NavigationEnd(3, '/calendar', '/calendar?view=month&date=2026-09-03&anchor=2026-09-03'), [0, 180], null));
    await Promise.resolve();
    expect(restore).not.toHaveBeenCalled();
  });

  it('selects empty days and exposes only active-plan and standalone workouts', async () => {
    watchSchedule.mockReturnValue(of(trainingSchedule()));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const day = fixture.componentInstance.calendarModel().months[0].days.find(item => item.dateKey === '2026-08-04')!;
    fixture.componentInstance.openDay(day);
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ view: 'month', date: '2026-08-04' }) }));
    queryParams.next(convertToParamMap({ view: 'month', date: '2026-08-04' }));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.selectedDayData()?.day.eventCount).toBe(0);
    expect(fixture.componentInstance.selectedDayPlanned().map(entry => entry.workout.id)).toEqual(['active-workout', 'standalone-workout']);
    expect(fixture.nativeElement.querySelector('app-calendar-day-context')).toBeTruthy();
  });

  it('keeps the duplicated workout destination selected inline', async () => {
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    pendingDestination.set('2026-08-10');
    queryParams.next(convertToParamMap({ view: 'month', date: '2026-08-10' }));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.selectedDay()?.dateKey).toBe('2026-08-10');
    expect(dayDetailsNavigation.consumeWorkoutDestination).toHaveBeenCalledWith(planningUserUid, '2026-08-10');
    expect(openBottomSheet).not.toHaveBeenCalled();
  });

  it('restores the inline selected day after returning from an activity', async () => {
    const restoration = { sourceUrl: '/', dateKey: '2026-08-03' };
    dayDetailsNavigation.restorationFor.mockReturnValue(restoration);
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(dayDetailsNavigation.consumeRestoration).toHaveBeenCalledWith(restoration);
    expect(fixture.componentInstance.selectedDay()?.dateKey).toBe('2026-08-03');
    expect(openBottomSheet).not.toHaveBeenCalled();
  });

  it('shows a retryable error state', async () => {
    watchEvents.mockReturnValue(throwError(() => new Error('offline')));
    watchSchedule.mockReturnValue(of(trainingSchedule()));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-day-button')).toHaveLength(
      fixture.componentInstance.calendarModel().months[0].days.length);
    expect(fixture.nativeElement.querySelector('.planned-workout-markers')).toBeTruthy();
    expect([...fixture.nativeElement.querySelectorAll('.calendar-selected-day .calendar-day-context-totals strong')]
      .map((value: HTMLElement) => value.textContent?.trim())).toEqual(['--', '--', '--']);
    expect(fixture.nativeElement.textContent).not.toContain('No completed activities in August 2026');
  });
  it('loads notes for empty days and opens them from the inline panel', async () => {
    notesService.loadRange.mockResolvedValue({ notes: [note], incomplete: null });
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.notesByDate().size).toBe(2));
    const day = fixture.componentInstance.calendarModel().months[0].days.find(item => item.dateKey === note.startDate)!;
    fixture.componentInstance.openDay(day);
    queryParams.next(convertToParamMap({ view: 'month', date: note.startDate }));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.selectedDayNotes()).toEqual([note]);
    expect(day.eventCount).toBe(0);
    fixture.componentInstance.selectDayNote(note.id);
    expect(dialogs.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: { uid: planningUserUid, notes: [note] } }));
  });

  it('clears inline private notes on account change and ignores stale selection', async () => {
    notesService.loadRange.mockResolvedValue({ notes: [note], incomplete: null });
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.notesByDate().size).toBe(2));
    fixture.componentInstance.openDay(fixture.componentInstance.calendarModel().months[0].days.find(day => day.dateKey === note.startDate)!);
    queryParams.next(convertToParamMap({ view: 'month', date: note.startDate }));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    notesService.uid.set('another-owner'); fixture.detectChanges();
    expect(fixture.componentInstance.selectedDayNotes()).toEqual([]);
    fixture.componentInstance.selectDayNote(note.id);
    expect(dialogs.open).not.toHaveBeenCalled();
  });

  it('keeps notes available when activities fail and does not hide activities when notes fail', async () => {
    watchEvents.mockReturnValue(throwError(() => new Error('offline')));
    notesService.loadRange.mockResolvedValue({ notes: [note], incomplete: 'records' });
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.notesByDate().size).toBe(2));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-calm-note')).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('Some notes not shown');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.calendar-status-announcement')).toBeNull();
    notesService.loadRange.mockRejectedValue(new Error('notes unavailable'));
    watchEvents.mockReturnValue(of([createEvent()]));
    fixture.componentInstance.retry(); notesService.changes$.next();
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Morning run');
    expect(fixture.nativeElement.querySelectorAll('.activity-calendar-day-button')).toHaveLength(
      fixture.componentInstance.calendarModel().months[0].days.length);
  });

  it('shows the selected month empty state when only an adjacent grid day has an activity', async () => {
    watchEvents.mockReturnValue(of([createEvent(new Date(2026, 8, 1, 8))]));
    const fixture = TestBed.createComponent(CalendarPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.hasEvents()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('No completed activities in August 2026');
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

function emptySchedule(): CurrentTrainingScheduleV1 {
  return {
    state: { schemaVersion: 1, activePlanId: null, revision: 0, currentWorkoutCount: 0, updatedAtMs: 0 },
    plans: [],
    workouts: [],
  };
}

function trainingSchedule(): CurrentTrainingScheduleV1 {
  const structure = {
    version: 1 as const,
    sport: ActivityTypes.Running,
    nodes: [{
      kind: 'step' as const,
      id: 'steady',
      purpose: 'work' as const,
      ending: { kind: 'time' as const, seconds: 1800 },
      targets: [],
    }],
  };
  return {
    state: { schemaVersion: 1, activePlanId: 'active-plan', revision: 1, currentWorkoutCount: 3, updatedAtMs: 1 },
    plans: [
      {
        schemaVersion: 1,
        id: 'active-plan',
        name: 'Active build',
        lifecycle: 'active',
        startLocalDate: '2026-08-01',
        endLocalDate: '2026-08-31',
        revision: 1,
        lastCheckpointRevision: 1,
        workoutCount: 1,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        schemaVersion: 1,
        id: 'inactive-plan',
        name: 'Paused build',
        lifecycle: 'paused',
        startLocalDate: '2026-08-01',
        endLocalDate: '2026-08-31',
        revision: 1,
        lastCheckpointRevision: 1,
        workoutCount: 1,
        createdAtMs: 2,
        updatedAtMs: 2,
      },
    ],
    workouts: [
      calendarWorkout('active-workout', 'active-plan', structure),
      calendarWorkout('standalone-workout', null, structure),
      calendarWorkout('inactive-workout', 'inactive-plan', structure),
    ],
  };
}

function calendarWorkout(
  id: string,
  planId: string | null,
  structure: WorkoutStructureV1,
) {
  return {
    schemaVersion: 1 as const,
    id,
    planId,
    localDate: '2026-08-04',
    lifecycle: 'planned' as const,
    title: id,
    structure,
    revision: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

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
