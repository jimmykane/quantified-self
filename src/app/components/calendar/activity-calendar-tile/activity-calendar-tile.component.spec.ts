import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { provideRouter } from '@angular/router';
import { ActivityTypes, DataDuration, DaysOfTheWeek, type EventInterface } from '@sports-alliance/sports-lib';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import type { TimelineNote, TimelineNoteRange } from '@shared/timeline-notes';
import type { TimelineNoteChartContext } from '../../../helpers/timeline-notes-chart.helper';
import type { CalendarDayDetailsData } from '../calendar-day-details/calendar-day-details.component';
import type { WorkoutStructureV1 } from '@shared/planned-workout';
import { ActivityCalendarService } from '../../../services/activity-calendar.service';
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
import { TrainingPlansService, type CurrentTrainingScheduleV1 } from '../../../services/training-plans.service';
import { ActivityCalendarTileComponent } from './activity-calendar-tile.component';
import { STANDALONE_WORKOUT_COLOR, trainingPlanAppearance } from '../../../helpers/training-plan-appearance.helper';

describe('ActivityCalendarTileComponent', () => {
  const user = {
    uid: 'user-1',
    settings: { unitSettings: { startOfTheWeek: DaysOfTheWeek.Monday } },
  };
  let watchEvents: ReturnType<typeof vi.fn>;
  let openBottomSheet: ReturnType<typeof vi.fn>;
  let watchSchedule: ReturnType<typeof vi.fn>;
  let dayDetailsNavigation: {
    restorationFor: ReturnType<typeof vi.fn>;
    consumeRestoration: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    watchEvents = vi.fn().mockReturnValue(of([createEvent()]));
    watchSchedule = vi.fn().mockReturnValue(of(emptySchedule()));
    openBottomSheet = vi.fn().mockReturnValue({ afterDismissed: () => of(undefined) });
    dayDetailsNavigation = {
      restorationFor: vi.fn().mockReturnValue(null),
      consumeRestoration: vi.fn().mockReturnValue(true),
    };
    await TestBed.configureTestingModule({
      imports: [ActivityCalendarTileComponent],
      providers: [
        provideRouter([]),
        { provide: ActivityCalendarService, useValue: { watchEvents } },
        { provide: TrainingPlansService, useValue: { watchSchedule } },
        { provide: CalendarDayDetailsNavigationService, useValue: dayDetailsNavigation },
      ],
    }).compileComponents();
  });

  it('loads the current month with its own query and renders compact concentric markers', async () => {
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(watchEvents).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('.activity-calendar-tile-progress')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.activity-calendar--compact')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.activity-calendar-marker-stage--concentric')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Activity calendar');
  });

  it('opens the shared day details sheet from an activity day', async () => {
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const componentBottomSheet = (fixture.componentInstance as unknown as {
      bottomSheet: MatBottomSheet;
    }).bottomSheet;
    vi.spyOn(componentBottomSheet, 'open').mockImplementation(openBottomSheet);
    (fixture.nativeElement.querySelector('.activity-calendar-day-button') as HTMLButtonElement).click();

    expect(openBottomSheet).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user-1',
        unitSettings: user.settings.unitSettings,
      }),
    }));
  });

  it.each([false, true])('keeps note-only days live after the tile / month popup is destroyed (navigation: %s)', async showNavigation => {
    const note: TimelineNote = { id: 'a'.repeat(64), title: 'Trip', category: 'travel', color: 'purple', startDate: currentLocalDate(2), endDate: currentLocalDate(2), timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
    const ranges = new Map<object, TimelineNoteRange>();
    const reportRange = vi.fn((key, range) => range ? ranges.set(key, range) : ranges.delete(key));
    const select = vi.fn();
    const source = signal<TimelineNoteChartContext | null>({ ownerUid: user.uid, notes: [note], select, reportRange });
    const dismissed$ = new Subject<string>();
    openBottomSheet.mockReturnValue({ afterDismissed: () => dismissed$ });
    watchEvents.mockReturnValue(of([]));
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.componentRef.setInput('showNavigation', showNavigation);
    fixture.componentRef.setInput('timelineNotes', source);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    vi.spyOn(fixture.debugElement.injector.get(MatBottomSheet), 'open').mockImplementation(openBottomSheet);
    const calendarRange = [...ranges.values()][0];
    expect(calendarRange.startDate <= note.startDate && calendarRange.endDate >= note.endDate!).toBe(true);
    const button = fixture.nativeElement.querySelector('[aria-label*="1 Timeline note"]') as HTMLButtonElement;
    expect(button.querySelector('.activity-calendar-note-indicator')?.textContent).toBe('flight');
    expect(fixture.nativeElement.querySelector('.activity-calendar-marker')).toBeNull();
    button.click();
    const data = openBottomSheet.mock.calls[0][1].data as CalendarDayDetailsData;
    expect(data.timelineNotes?.()).toEqual([note]);
    fixture.destroy();
    expect([...ranges.values()]).toEqual([{ startDate: note.startDate, endDate: note.endDate }]);
    const edited = { ...note, title: 'Changed trip', revision: 2 };
    source.set({ ...source()!, notes: [edited] });
    expect(data.timelineNotes?.()).toEqual([edited]);
    dismissed$.next(note.id); dismissed$.complete();
    expect(select).toHaveBeenCalledExactlyOnceWith([edited]);
    expect(ranges.size).toBe(0);
  });

  it.each([false, true])('finishes loading a note day after its tile / month popup closes without duplicate queries (navigation: %s)', async showNavigation => {
    const dateKey = currentLocalDate(2);
    const events$ = new Subject<EventInterface[]>();
    const plans$ = new Subject<CurrentTrainingScheduleV1>();
    const dismissed$ = new Subject<string>();
    const note: TimelineNote = { id: 'a'.repeat(64), title: 'Rest day', category: 'other', startDate: dateKey, endDate: dateKey, timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
    watchEvents.mockReturnValue(events$);
    watchSchedule.mockReturnValue(plans$);
    openBottomSheet.mockReturnValue({ afterDismissed: () => dismissed$ });
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.componentRef.setInput('showNavigation', showNavigation);
    fixture.componentRef.setInput('timelineNotes', signal({ ownerUid: user.uid, notes: [note], select: vi.fn(), reportRange: vi.fn() }));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    vi.spyOn(fixture.debugElement.injector.get(MatBottomSheet), 'open').mockImplementation(openBottomSheet);
    (fixture.nativeElement.querySelector('[aria-label*="1 Timeline note"]') as HTMLButtonElement).click();
    const data = openBottomSheet.mock.calls[0][1].data as CalendarDayDetailsData;
    expect(data.timelineNotes?.()).toEqual([note]);
    expect(data.activities?.().status).toBe('loading');
    expect(data.plannedWorkoutsStatusSource?.()).toBe('loading');
    expect(watchEvents).toHaveBeenCalledOnce();
    expect(watchSchedule).toHaveBeenCalledOnce();
    expect(events$.observers).toHaveLength(1);
    expect(plans$.observers).toHaveLength(1);
    fixture.destroy();
    expect(events$.observed).toBe(true);
    expect(plans$.observed).toBe(true);
    const now = new Date();
    const event = createEvent(new Date(now.getFullYear(), now.getMonth(), 2, 8));
    events$.next([event]);
    plans$.next(scheduleForDate(dateKey));
    expect(data.activities?.()).toMatchObject({ status: 'ready', day: { dateKey, events: [event], eventCount: 1 } });
    expect(data.plannedWorkoutsStatusSource?.()).toBe('ready');
    expect(data.plannedWorkoutsSource?.().map(entry => entry.workout.id)).toEqual(['active-workout', 'standalone-workout']);
    dismissed$.next(undefined); dismissed$.complete();
    expect(events$.observed).toBe(false);
    expect(plans$.observed).toBe(false);
  });

  it('preserves activity and schedule failures in note day details instead of reporting empty results', async () => {
    const events$ = new Subject<EventInterface[]>();
    watchEvents.mockReturnValue(events$);
    watchSchedule.mockReturnValue(throwError(() => new Error('offline')));
    const dismissed$ = new Subject<string>();
    openBottomSheet.mockReturnValue({ afterDismissed: () => dismissed$ });
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges(); await fixture.whenStable();
    vi.spyOn(fixture.debugElement.injector.get(MatBottomSheet), 'open').mockImplementation(openBottomSheet);
    const day = fixture.componentInstance.calendarModel().months[0].days.find(day => day.dateKey === currentLocalDate(2))!;
    fixture.componentInstance.openDay(day);
    const data = openBottomSheet.mock.calls[0][1].data as CalendarDayDetailsData;
    expect(data.activities?.().status).toBe('loading');
    expect(data.plannedWorkoutsStatusSource?.()).toBe('error');
    fixture.destroy();
    events$.error(new Error('offline'));
    expect(data.activities?.().status).toBe('error');
    dismissed$.next(undefined); dismissed$.complete();
  });

  it('releases the selected day range and retained subscriptions if opening the sheet fails', async () => {
    const events$ = new Subject<EventInterface[]>();
    const plans$ = new Subject<CurrentTrainingScheduleV1>();
    const ranges = new Map<object, TimelineNoteRange>();
    const reportRange = (key: object, range: TimelineNoteRange | null) => range ? ranges.set(key, range) : ranges.delete(key);
    watchEvents.mockReturnValue(events$); watchSchedule.mockReturnValue(plans$);
    openBottomSheet.mockImplementation(() => { throw new Error('Sheet could not open'); });
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.componentRef.setInput('timelineNotes', signal({ ownerUid: user.uid, notes: [], select: vi.fn(), reportRange }));
    fixture.detectChanges(); await fixture.whenStable();
    vi.spyOn(fixture.debugElement.injector.get(MatBottomSheet), 'open').mockImplementation(openBottomSheet);
    const day = fixture.componentInstance.calendarModel().months[0].days.find(day => day.dateKey === currentLocalDate(2))!;
    expect(() => fixture.componentInstance.openDay(day)).toThrow('Sheet could not open');
    expect(ranges.size).toBe(1); // Only the mounted calendar remains registered.
    fixture.destroy();
    expect(ranges.size).toBe(0);
    expect(events$.observed).toBe(false);
    expect(plans$.observed).toBe(false);
  });

  it('clears private notes on visibility/account changes and rejects a stale day selection', async () => {
    const note: TimelineNote = { id: 'a'.repeat(64), title: 'Private', category: 'other', startDate: currentLocalDate(2), endDate: currentLocalDate(2), timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
    const select = vi.fn();
    const source = signal<TimelineNoteChartContext | null>({ ownerUid: 'another-owner', notes: [note], select, reportRange: vi.fn() });
    const dismissed$ = new Subject<string>();
    openBottomSheet.mockReturnValue({ afterDismissed: () => dismissed$ });
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.componentRef.setInput('timelineNotes', source);
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.componentInstance.notesByDate().size).toBe(0);
    source.set({ ...source()!, ownerUid: user.uid }); fixture.detectChanges();
    vi.spyOn(fixture.debugElement.injector.get(MatBottomSheet), 'open').mockImplementation(openBottomSheet);
    const day = fixture.componentInstance.calendarModel().months[0].days.find(day => day.dateKey === note.startDate)!;
    fixture.componentInstance.openDay(day);
    const data = openBottomSheet.mock.calls[0][1].data as CalendarDayDetailsData;
    source.set({ ...source()!, notes: [{ ...note, showOnCharts: false }] });
    expect(data.timelineNotes?.()).toEqual([]);
    expect(fixture.componentInstance.notesByDate().size).toBe(0);
    source.set({ ...source()!, ownerUid: 'another-owner', notes: [note] });
    expect(data.timelineNotes?.()).toEqual([]);
    dismissed$.next(note.id); dismissed$.complete();
    expect(select).not.toHaveBeenCalled();
  });

  it('updates the registered month while notes remain usable when activities fail', async () => {
    const note: TimelineNote = { id: 'a'.repeat(64), title: 'Travel', category: 'travel', startDate: currentLocalDate(2), endDate: currentLocalDate(2), timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
    const reportRange = vi.fn();
    const source = signal<TimelineNoteChartContext | null>({ ownerUid: user.uid, notes: [note], select: vi.fn(), reportRange });
    watchEvents.mockReturnValue(throwError(() => new Error('offline')));
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user); fixture.componentRef.setInput('timelineNotes', source);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label*="1 Timeline note"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Calendar unavailable');
    const firstRange = reportRange.mock.calls.at(-1)?.[1];
    fixture.componentInstance.navigateMonth(-1); fixture.detectChanges(); await fixture.whenStable();
    expect(reportRange.mock.calls.at(-1)?.[1].startDate < firstRange.startDate).toBe(true);
    fixture.destroy();
    expect(reportRange).toHaveBeenLastCalledWith(fixture.componentInstance, null);
  });

  it('shows active-plan and standalone workouts and passes them to empty-day details', async () => {
    const plannedDate = currentLocalDate(2);
    watchSchedule.mockReturnValue(of(scheduleForDate(plannedDate)));
    watchEvents.mockReturnValue(of([]));
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const componentBottomSheet = (fixture.componentInstance as unknown as {
      bottomSheet: MatBottomSheet;
    }).bottomSheet;
    const componentOpen = vi.spyOn(componentBottomSheet, 'open').mockImplementation(openBottomSheet);
    const day = fixture.componentInstance.calendarModel().months[0].days
      .find(candidate => candidate.dateKey === plannedDate)!;

    expect(fixture.nativeElement.querySelector('.planned-workout-markers')).toBeTruthy();
    fixture.componentInstance.openDay(day);

    const plannedWorkouts = (componentOpen.mock.calls[0][1] as {
      data: { plannedWorkouts: Array<{ workout: { id: string } }> };
    }).data.plannedWorkouts;
    expect(plannedWorkouts.map(entry => entry.workout.id)).toEqual(['active-workout', 'standalone-workout']);
  });

  it.each([false, true])('updates saved plan colors in the tile / Today picker (navigation: %s) without changing activities', async showNavigation => {
    const plannedDate = currentLocalDate(2);
    const schedule = scheduleForDate(plannedDate);
    const scheduleChanges = new BehaviorSubject(schedule);
    watchSchedule.mockReturnValue(scheduleChanges);
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.componentRef.setInput('showNavigation', showNavigation);
    fixture.componentRef.setInput('showHeading', !showNavigation);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const originalModel = fixture.componentInstance.calendarModel();
    const activity = fixture.nativeElement.querySelector('.activity-calendar-marker') as HTMLElement;
    const originalActivityStyle = activity.getAttribute('style');
    const colors = () => fixture.componentInstance.plannedWorkoutsByDate()[plannedDate].visibleEntries.map(entry => entry.color);
    expect(colors()).toEqual([trainingPlanAppearance(null).color, STANDALONE_WORKOUT_COLOR]);

    scheduleChanges.next({ ...schedule, plans: schedule.plans.map(plan => ({ ...plan, color: 'purple' as const })) });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(colors()).toEqual([trainingPlanAppearance({ color: 'purple' }).color, STANDALONE_WORKOUT_COLOR]);
    expect(fixture.nativeElement.querySelectorAll('.planned-workout-markers mat-icon')).toHaveLength(2);
    expect(fixture.componentInstance.calendarModel()).toBe(originalModel);
    expect(activity.getAttribute('style')).toBe(originalActivityStyle);
    expect(watchEvents).toHaveBeenCalledOnce();
  });

  it('pages the compact month picker without rendering the tile heading', async () => {
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.componentRef.setInput('showHeading', false);
    fixture.componentRef.setInput('showNavigation', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const initialPeriod = fixture.componentInstance.calendarModel().periodLabel;
    const previousMonth = fixture.nativeElement.querySelector('[aria-label="Previous month"]') as HTMLButtonElement;
    expect(fixture.nativeElement.querySelector('#activity-calendar-tile-title')).toBeNull();
    expect(fixture.nativeElement.querySelector('.activity-calendar-tile-navigation')?.textContent).toContain(initialPeriod);

    previousMonth.click();
    fixture.detectChanges();

    expect(watchEvents).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.calendarModel().periodLabel).not.toBe(initialPeriod);
  });

  it('shows a retry action when the month query fails', async () => {
    watchEvents.mockReturnValue(throwError(() => new Error('offline')));
    watchSchedule.mockReturnValue(of(scheduleForDate(currentLocalDate(2))));
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('Calendar unavailable');
    expect(fixture.nativeElement.querySelector('.activity-calendar-day-button')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.planned-workout-markers')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('No completed activities this month');
  });

  it('shows the empty state when query results only belong to an adjacent month', async () => {
    const now = new Date();
    watchEvents.mockReturnValue(of([createEvent(new Date(now.getFullYear(), now.getMonth() + 1, 1, 8))]));
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No completed activities this month');
    expect(fixture.nativeElement.querySelector('.activity-calendar-day-button')).toBeTruthy();
  });

  it('refreshes the today marker without re-querying during the same month', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 7, 3, 10));
      watchEvents.mockReturnValue(of([createEvent(new Date(2026, 7, 3, 8))]));
      const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
      fixture.componentRef.setInput('user', user);
      fixture.detectChanges();

      vi.setSystemTime(new Date(2026, 7, 4, 10));
      fixture.componentInstance.refreshCalendarDate();

      expect(fixture.componentInstance.calendarModel().months[0].days
        .find(day => day.dateKey === '2026-08-04')?.isToday).toBe(true);
      expect(watchEvents).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('extends ongoing notes to today when a background tab returns after midnight', () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    try {
      vi.setSystemTime(new Date(2026, 8, 11, 12));
      const note: TimelineNote = { id: 'a'.repeat(64), title: 'Rest', category: 'other', startDate: '2026-09-11', endDate: null, timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
      const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
      fixture.componentRef.setInput('user', user);
      fixture.componentRef.setInput('timelineNotes', signal({ ownerUid: user.uid, notes: [note], select: vi.fn(), reportRange: vi.fn() }));
      fixture.detectChanges();
      expect(fixture.componentInstance.notesByDate().has('2026-09-11')).toBe(true);
      expect(fixture.componentInstance.notesByDate().has('2026-09-12')).toBe(false);
      vi.setSystemTime(new Date(2026, 8, 12, 12));
      visibility.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'));
      expect(fixture.componentInstance.notesByDate().has('2026-09-12')).toBe(false);
      visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
      expect(fixture.componentInstance.notesByDate().has('2026-09-12')).toBe(true);
      expect(fixture.componentInstance.notesByDate().has('2026-09-13')).toBe(false);
      fixture.destroy();
    } finally { visibility.mockRestore(); vi.useRealTimers(); }
  });

  it('reopens day details after returning from an event route', async () => {
    const now = new Date();
    const dateKey = [
      now.getFullYear(),
      `${now.getMonth() + 1}`.padStart(2, '0'),
      `${Math.max(1, now.getDate())}`.padStart(2, '0'),
    ].join('-');
    const restoration = { sourceUrl: '/', dateKey };
    dayDetailsNavigation.restorationFor.mockReturnValue(restoration);
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    const componentBottomSheet = (fixture.componentInstance as unknown as {
      bottomSheet: MatBottomSheet;
    }).bottomSheet;
    vi.spyOn(componentBottomSheet, 'open').mockImplementation(openBottomSheet);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dayDetailsNavigation.consumeRestoration).toHaveBeenCalledWith(restoration);
    expect(openBottomSheet).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      data: expect.objectContaining({ day: expect.objectContaining({ dateKey }) }),
    }));
  });

  it('waits for a deleted event to leave the live day before restoring its remaining activities', async () => {
    const now = new Date();
    const eventDate = new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate()), 8);
    const dateKey = [
      eventDate.getFullYear(),
      `${eventDate.getMonth() + 1}`.padStart(2, '0'),
      `${eventDate.getDate()}`.padStart(2, '0'),
    ].join('-');
    const deletedEvent = createEvent(eventDate, 'event-1');
    const remainingEvent = createEvent(new Date(eventDate.getTime() + 60 * 60 * 1000), 'event-2');
    const events = new BehaviorSubject<EventInterface[]>([deletedEvent, remainingEvent]);
    watchEvents.mockReturnValue(events.asObservable());
    const restoration = { sourceUrl: '/', dateKey, deletedEventId: 'event-1' };
    dayDetailsNavigation.restorationFor.mockReturnValue(restoration);
    const fixture = TestBed.createComponent(ActivityCalendarTileComponent);
    const componentBottomSheet = (fixture.componentInstance as unknown as {
      bottomSheet: MatBottomSheet;
    }).bottomSheet;
    vi.spyOn(componentBottomSheet, 'open').mockImplementation(openBottomSheet);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(dayDetailsNavigation.consumeRestoration).not.toHaveBeenCalled();
    expect(openBottomSheet).not.toHaveBeenCalled();

    events.next([remainingEvent]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dayDetailsNavigation.consumeRestoration).toHaveBeenCalledWith(restoration);
    expect(openBottomSheet).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      data: expect.objectContaining({
        day: expect.objectContaining({ events: [remainingEvent] }),
      }),
    }));
  });

  it('constrains the compact grid to the tile content area', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/calendar/activity-calendar-tile/activity-calendar-tile.component.scss'),
      'utf8',
    );
    const gridRule = styles.match(/app-activity-calendar-grid\s*\{([^}]*)\}/)?.[1];

    expect(gridRule).toContain('min-height: 0;');
    expect(gridRule).toContain('flex: 1 1 0;');
    expect(gridRule).toContain('overflow: hidden;');
  });
});

function emptySchedule(): CurrentTrainingScheduleV1 {
  return {
    state: { schemaVersion: 1, activePlanId: null, revision: 0, currentWorkoutCount: 0, updatedAtMs: 0 },
    plans: [],
    workouts: [],
  };
}

function scheduleForDate(localDate: string): CurrentTrainingScheduleV1 {
  const rangeStart = currentLocalDate(1);
  const rangeEnd = currentLocalDate(28);
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
        startLocalDate: rangeStart,
        endLocalDate: rangeEnd,
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
        startLocalDate: rangeStart,
        endLocalDate: rangeEnd,
        revision: 1,
        lastCheckpointRevision: 1,
        workoutCount: 1,
        createdAtMs: 2,
        updatedAtMs: 2,
      },
    ],
    workouts: [
      plannedWorkout('active-workout', 'active-plan', localDate, structure),
      plannedWorkout('standalone-workout', null, localDate, structure),
      plannedWorkout('inactive-workout', 'inactive-plan', localDate, structure),
    ],
  };
}

function plannedWorkout(
  id: string,
  planId: string | null,
  localDate: string,
  structure: WorkoutStructureV1,
) {
  return {
    schemaVersion: 1 as const,
    id,
    planId,
    localDate,
    lifecycle: 'planned' as const,
    title: id,
    structure,
    revision: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function currentLocalDate(day: number): string {
  const now = new Date();
  return [now.getFullYear(), `${now.getMonth() + 1}`.padStart(2, '0'), `${day}`.padStart(2, '0')].join('-');
}

function createEvent(startDate?: Date, eventId = 'event-1'): EventInterface {
  const now = new Date();
  return {
    name: 'Morning run',
    startDate: startDate || new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate()), 8),
    getID: () => eventId,
    getActivityTypesAsArray: () => [ActivityTypes.Running],
    getActivityTypesAsString: () => 'Running',
    getStat: (type: string) => type === DataDuration.type ? { getValue: () => 3600 } : null,
  } as unknown as EventInterface;
}
