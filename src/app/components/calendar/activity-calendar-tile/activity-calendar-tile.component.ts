import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  LOCALE_ID,
  computed,
  effect,
  inject,
  input,
  signal,
  type Signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { Router } from '@angular/router';
import type { EventInterface, User } from '@sports-alliance/sports-lib';
import { catchError, distinctUntilChanged, finalize, map, of, shareReplay, startWith, Subscription, switchMap, take } from 'rxjs';
import { isTimelineNoteVisible, timelineNoteOverlaps } from '@shared/timeline-notes';
import type { TimelineNoteChartContext } from '../../../helpers/timeline-notes-chart.helper';
import { calendarTimelineNoteRange, calendarTimelineNotesByDate } from '../../../helpers/calendar-timeline-notes.helper';
import { revealCalendarDayContext } from '../../../helpers/reveal-calendar-day-context.helper';
import {
  type ActivityCalendarDayViewModel,
  buildActivityCalendarViewModel,
  navigateActivityCalendarDate,
  parseActivityCalendarDate,
  resolveActivityCalendarQueryWindow,
} from '../../../helpers/activity-calendar.helper';
import { SharedModule } from '../../../modules/shared.module';
import { ActivityCalendarService } from '../../../services/activity-calendar.service';
import { AppUserService } from '../../../services/app.user.service';
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
import {
  TrainingPlansService,
  selectCalendarVisibleScheduledWorkouts,
  type CurrentTrainingScheduleV1,
} from '../../../services/training-plans.service';
import { ActivityCalendarGridComponent } from '../activity-calendar-grid/activity-calendar-grid.component';
import { CalendarDayContextComponent } from '../calendar-day-context/calendar-day-context.component';
import {
  CalendarDayDetailsComponent,
  type CalendarDayDetailsData,
  type CalendarDayDetailsResult,
} from '../calendar-day-details/calendar-day-details.component';
import {
  buildPlannedWorkoutCalendarOverlay,
  type PlannedWorkoutCalendarOverlay,
} from '../../../helpers/planned-workout-calendar.helper';

interface ActivityCalendarTileState {
  status: 'loading' | 'ready' | 'error';
  events: EventInterface[];
}

interface ActivityCalendarTilePlansState {
  status: 'loading' | 'ready' | 'error';
  schedule: CurrentTrainingScheduleV1 | null;
}

@Component({
  selector: 'app-activity-calendar-tile',
  standalone: true,
  imports: [SharedModule, ActivityCalendarGridComponent, CalendarDayContextComponent],
  templateUrl: './activity-calendar-tile.component.html',
  styleUrls: ['./activity-calendar-tile.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.activity-calendar-tile--auto-height]': '!fillHeight()', '[class.activity-calendar-tile--day-context]': 'dayContextEnabled()' },
})
export class ActivityCalendarTileComponent {
  private readonly calendarService = inject(ActivityCalendarService);
  private readonly plansService = inject(TrainingPlansService);
  private readonly users = inject(AppUserService);
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly router = inject(Router);
  private readonly dayDetailsNavigation = inject(CalendarDayDetailsNavigationService);
  private readonly locale = inject(LOCALE_ID);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly anchorDate = signal(startOfCurrentMonth());
  private readonly followsCurrentMonth = signal(true);
  private readonly reloadSequence = signal(0);
  private readonly today = signal(new Date());

  readonly user = input<User | null | undefined>(null);
  readonly hasTrainingPlanningUIAccess = computed(() => {
    const viewerUid = this.users.user()?.uid;
    return !!viewerUid && this.user()?.uid === viewerUid;
  });
  /** Keep the workspace signal live even when the month popup is replaced by a day sheet. */
  readonly timelineNotes = input<Signal<TimelineNoteChartContext | null> | null>(null);
  private readonly notesContext = computed(() => {
    const context = this.timelineNotes()?.();
    return this.user()?.uid && context?.ownerUid === this.user()?.uid ? context : null;
  });
  private readonly reportNotesRange = computed(() => this.notesContext()?.reportRange);
  readonly showHeading = input(true);
  readonly fillHeight = input(true);
  readonly showNavigation = input(false);
  readonly dayContextEnabled = input(false);
  readonly privateHealthEnabled = input(true);
  readonly initialDateKey = input<string | null>(null);
  readonly selectedDateKey = signal(localDateKey(new Date()));
  private openedInitialDateKey: string | null = null;
  // Share each concrete query with an open day sheet. Material destroys the month popup when
  // replacing it, but the selected day's pending data must continue until its own sheet closes.
  private readonly eventsSource = computed(() => {
    const user = this.user();
    const anchorDate = this.anchorDate();
    this.reloadSequence();
    if (!user?.uid) return of({ status: 'ready', events: [] } as ActivityCalendarTileState);
    const queryWindow = resolveActivityCalendarQueryWindow(
      'month', anchorDate, user.settings?.unitSettings?.startOfTheWeek,
    );
    return this.calendarService.watchEvents(user, queryWindow).pipe(
      map(events => ({ status: 'ready', events }) as ActivityCalendarTileState),
      startWith({ status: 'loading', events: [] } as ActivityCalendarTileState),
      catchError(() => of({ status: 'error', events: [] } as ActivityCalendarTileState)),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  });
  readonly eventState = toSignal(toObservable(this.eventsSource).pipe(switchMap(source => source)),
    { initialValue: { status: 'loading', events: [] } as ActivityCalendarTileState });
  private readonly plansSource = computed(() => {
    const user = this.user();
    if (!user?.uid) return of({ status: 'ready', schedule: null } as ActivityCalendarTilePlansState);
    // A popup's user input is a snapshot. Keep the live viewer fence inside the shared
    // stream so it also cancels a day-sheet listener after Material destroys this tile.
    return this.users.user$.pipe(
      map(viewer => viewer?.uid ?? null),
      distinctUntilChanged(),
      switchMap(viewerUid => viewerUid === user.uid ? this.plansService.watchSchedule(user.uid).pipe(
        map(schedule => ({ status: 'ready', schedule }) as ActivityCalendarTilePlansState),
        startWith({ status: 'loading', schedule: null } as ActivityCalendarTilePlansState),
        catchError(() => of({ status: 'error', schedule: null } as ActivityCalendarTilePlansState)),
      ) : of({ status: 'ready', schedule: null } as ActivityCalendarTilePlansState)),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  });
  readonly plansState = toSignal(toObservable(this.plansSource).pipe(switchMap(source => source)),
    { initialValue: { status: 'loading', schedule: null } as ActivityCalendarTilePlansState });
  private readonly completionsSource = computed(() => {
    const user = this.user();
    if (!user?.uid) return of([]);
    return this.users.user$.pipe(
      map(viewer => viewer?.uid ?? null),
      distinctUntilChanged(),
      switchMap(viewerUid => viewerUid === user.uid
        ? this.plansService.watchWorkoutCompletions(user.uid).pipe(
          startWith([]),
          catchError(() => of([])),
        )
        : of([])),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  });
  readonly workoutCompletions = toSignal(toObservable(this.completionsSource).pipe(switchMap(source => source)),
    { initialValue: [] });
  readonly plannedWorkoutsByDate = computed<PlannedWorkoutCalendarOverlay>(() => {
    const schedule = this.plansState().schedule;
    if (!this.hasTrainingPlanningUIAccess() || !schedule) return {};
    return buildPlannedWorkoutCalendarOverlay(
      selectCalendarVisibleScheduledWorkouts(schedule),
      schedule.plans,
      schedule.state.activePlanId,
      this.workoutCompletions().map(completion => completion.workoutId),
    );
  });
  readonly calendarModel = computed(() => buildActivityCalendarViewModel(this.eventState().events, {
    view: 'month',
    anchorDate: this.anchorDate(),
    startOfWeek: this.user()?.settings?.unitSettings?.startOfTheWeek,
    locale: this.locale,
    now: this.today(),
  }));
  readonly isLoading = computed(() => this.eventState().status === 'loading');
  readonly selectedDay = computed(() => this.calendarModel().months.flatMap(month => month.days)
    .find(day => day.dateKey === this.selectedDateKey())
    ?? this.calendarModel().months.flatMap(month => month.days).find(day => day.inPrimaryPeriod)
    ?? null);
  readonly selectedDayActivities = computed(() => ({
    day: this.selectedDay()!, status: this.eventState().status,
  }));
  readonly selectedDayNotes = computed(() => this.notesByDate().get(this.selectedDay()?.dateKey || '')?.notes ?? []);
  readonly selectedDayPlanned = computed(() => this.plannedWorkoutsByDate()[this.selectedDay()?.dateKey || '']?.entries ?? []);
  readonly selectedDayData = computed<CalendarDayDetailsData | null>(() => {
    const day = this.selectedDay();
    const user = this.user();
    if (!day || !user?.uid) return null;
    return {
      day, userId: user.uid, locale: this.locale,
      privateHealthEnabled: this.privateHealthEnabled(),
      planningEnabled: this.hasTrainingPlanningUIAccess(),
      unitSettings: user.settings?.unitSettings ?? null,
      summariesSettings: user.settings?.summariesSettings ?? null,
      timelineNotes: this.selectedDayNotes,
      activities: this.selectedDayActivities,
      plannedWorkoutsSource: this.selectedDayPlanned,
      plannedWorkoutsStatusSource: () => this.plansState().status,
      scheduleSource: () => this.users.user()?.uid === user.uid ? this.plansState().schedule : null,
    };
  });
  selectDayNote(noteId: string): void {
    const note = this.selectedDayNotes().find(candidate => candidate.id === noteId);
    const context = this.notesContext();
    if (note && context?.ownerUid === this.users.user()?.uid) context.select([note]);
  }
  readonly notesByDate = computed(() => calendarTimelineNotesByDate(this.calendarModel(), this.notesContext()?.notes ?? [], this.today().getTime()));
  private readonly notesRange = computed(() => calendarTimelineNoteRange(this.calendarModel()));
  private readonly notesRangeEffect = effect(onCleanup => {
    const report = this.reportNotesRange();
    if (!report) return;
    report(this, this.notesRange());
    onCleanup(() => report(this, null));
  });
  readonly hasError = computed(() => this.eventState().status === 'error');
  readonly hasEvents = computed(() => this.calendarModel().months.some(month => (
    month.days.some(day => day.inPrimaryPeriod && day.eventCount > 0)
  )));
  private readonly restoreDayDetailsEffect = effect(() => {
    const restoration = this.dayDetailsNavigation.restorationFor(this.router.url);
    if (!restoration || restoration.surface === 'today-sheet') {
      return;
    }

    if (this.dayContextEnabled() && this.selectedDateKey() !== restoration.dateKey) {
      this.selectedDateKey.set(restoration.dateKey);
    }

    const restoredMonth = startOfCurrentMonth(parseActivityCalendarDate(restoration.dateKey));
    if (restoredMonth.getTime() !== this.anchorDate().getTime()) {
      this.followsCurrentMonth.set(false);
      this.anchorDate.set(restoredMonth);
      return;
    }
    if (this.eventState().status !== 'ready') {
      return;
    }

    const day = this.calendarModel().months
      .flatMap(month => month.days)
      .find(candidate => candidate.dateKey === restoration.dateKey);
    if (restoration.deletedEventId && day?.events.some(event => event.getID() === restoration.deletedEventId)) {
      return;
    }
    if (!this.dayDetailsNavigation.consumeRestoration(restoration)) {
      return;
    }
    if (day) {
      this.openDay(day, false);
    }
  });
  private readonly openInitialDayEffect = effect(() => {
    const dateKey = this.initialDateKey();
    if (!dateKey || !this.user()?.uid || this.dayContextEnabled() || this.openedInitialDateKey === dateKey) return;
    const date = parseActivityCalendarDate(dateKey);
    const month = startOfCurrentMonth(date);
    if (month.getTime() !== this.anchorDate().getTime()) {
      this.followsCurrentMonth.set(false);
      this.anchorDate.set(month);
      return;
    }
    const day = this.calendarModel().months.flatMap(value => value.days)
      .find(candidate => candidate.dateKey === dateKey);
    if (!day) return;
    this.openedInitialDateKey = dateKey;
    this.openDay(day, false);
  });

  @HostListener('window:focus')
  refreshCalendarDate(): void {
    const now = new Date();
    this.today.set(now);
    if (!this.followsCurrentMonth()) {
      return;
    }
    const currentMonth = startOfCurrentMonth(now);
    if (currentMonth.getTime() !== this.anchorDate().getTime()) {
      this.anchorDate.set(currentMonth);
    }
  }

  @HostListener('document:visibilitychange')
  refreshVisibleCalendarDate(): void {
    if (document.visibilityState === 'visible') this.refreshCalendarDate();
  }

  retry(): void {
    this.reloadSequence.update(value => value + 1);
  }

  navigateMonth(direction: -1 | 1): void {
    this.followsCurrentMonth.set(false);
    const target = navigateActivityCalendarDate(this.anchorDate(), 'month', direction);
    this.anchorDate.set(target);
    const selected = new Date(`${this.selectedDateKey()}T12:00:00`);
    const dayOfMonth = Number.isFinite(selected.getTime()) ? selected.getDate() : 1;
    const next = new Date(target.getFullYear(), target.getMonth(), Math.min(dayOfMonth, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
    this.selectedDateKey.set(localDateKey(next));
  }

  openDay(day: ActivityCalendarDayViewModel, revealDay = true): void {
    if (this.dayContextEnabled()) {
      this.selectedDateKey.set(day.dateKey);
      if (revealDay) requestAnimationFrame(() => revealCalendarDayContext(this.elementRef.nativeElement));
      return;
    }
    const user = this.user();
    const userId = `${user?.uid || ''}`.trim();
    if (!userId) {
      return;
    }
    const source = this.timelineNotes();
    const range = { startDate: day.dateKey, endDate: day.dateKey };
    const context = source?.();
    const report = context?.ownerUid === userId ? context.reportRange : undefined;
    const rangeKey = {};
    // The month sheet is destroyed when Material opens the day sheet. Retain its selected day's
    // range and the workspace signal until that sheet closes, independently of this tile's lifetime.
    report?.(rangeKey, range);
    const timelineNotes = computed(() => {
      const current = source?.();
      return current?.ownerUid === userId
        ? current.notes.filter(note => isTimelineNoteVisible(note) && timelineNoteOverlaps(note, range)) : [];
    });
    const subscriptions = new Subscription();
    const eventState = signal(this.eventState());
    const plansState = signal(this.plansState());
    const workoutCompletions = signal(this.workoutCompletions());
    const monthOptions = {
      view: 'month' as const,
      anchorDate: day.date,
      startOfWeek: user.settings?.unitSettings?.startOfTheWeek,
      locale: this.locale,
      now: this.today(),
    };
    const activities = computed(() => {
      const state = eventState();
      const currentDay = buildActivityCalendarViewModel(state.events, monthOptions).months
        .flatMap(month => month.days).find(candidate => candidate.dateKey === day.dateKey);
      return { status: state.status, day: currentDay ?? day };
    });
    const plannedWorkouts = computed(() => {
      const schedule = plansState().schedule;
      return schedule ? buildPlannedWorkoutCalendarOverlay(
        selectCalendarVisibleScheduledWorkouts(schedule), schedule.plans, schedule.state.activePlanId,
        workoutCompletions().map(completion => completion.workoutId),
      )[day.dateKey]?.entries ?? [] : [];
    });
    const release = () => {
      subscriptions.unsubscribe();
      report?.(rangeKey, null);
    };
    try {
      subscriptions.add(this.eventsSource().subscribe(state => eventState.set(state)));
      subscriptions.add(this.plansSource().subscribe(state => plansState.set(state)));
      subscriptions.add(this.completionsSource().subscribe(completions => workoutCompletions.set(completions)));
      const sheet = this.bottomSheet.open<CalendarDayDetailsComponent, CalendarDayDetailsData, CalendarDayDetailsResult>(CalendarDayDetailsComponent, {
        data: {
          day,
          userId,
          privateHealthEnabled: this.privateHealthEnabled(),
          planningEnabled: this.hasTrainingPlanningUIAccess(),
          timelineNotes,
          activities,
          locale: this.locale,
          unitSettings: user.settings?.unitSettings ?? null,
          summariesSettings: user.settings?.summariesSettings ?? null,
          plannedWorkouts: plannedWorkouts(),
          plannedWorkoutsSource: plannedWorkouts,
          plannedWorkoutsStatusSource: () => plansState().status,
          scheduleSource: () => this.users.user()?.uid === userId ? plansState().schedule : null,
        },
      });
      sheet.afterDismissed().pipe(take(1), finalize(release)).subscribe(result => {
        if (result && typeof result !== 'string') {
          if (this.users.user()?.uid !== userId
            || !this.dayDetailsNavigation.prepareWorkoutDestination(userId, result.localDate)) return;
          void this.router.navigate(['/calendar'], { queryParams: { view: 'month', date: result.localDate } });
          return;
        }
        const note = timelineNotes().find(note => note.id === result);
        if (note) source?.()?.select([note]);
      });
    } catch (error) {
      release();
      throw error;
    }
  }
}

function startOfCurrentMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}
