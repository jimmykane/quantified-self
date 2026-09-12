import {
  ChangeDetectionStrategy,
  Component,
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
import { catchError, finalize, map, of, shareReplay, startWith, Subscription, switchMap, take } from 'rxjs';
import { isTimelineNoteVisible, timelineNoteOverlaps } from '@shared/timeline-notes';
import type { TimelineNoteChartContext } from '../../../helpers/timeline-notes-chart.helper';
import { calendarTimelineNoteRange, calendarTimelineNotesByDate } from '../../../helpers/calendar-timeline-notes.helper';
import {
  type ActivityCalendarDayViewModel,
  buildActivityCalendarViewModel,
  navigateActivityCalendarDate,
  parseActivityCalendarDate,
  resolveActivityCalendarQueryWindow,
} from '../../../helpers/activity-calendar.helper';
import { SharedModule } from '../../../modules/shared.module';
import { ActivityCalendarService } from '../../../services/activity-calendar.service';
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
import {
  TrainingPlansService,
  selectCalendarVisibleScheduledWorkouts,
  type CurrentTrainingScheduleV1,
} from '../../../services/training-plans.service';
import { ActivityCalendarGridComponent } from '../activity-calendar-grid/activity-calendar-grid.component';
import {
  CalendarDayDetailsComponent,
  type CalendarDayDetailsData,
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
  imports: [SharedModule, ActivityCalendarGridComponent],
  templateUrl: './activity-calendar-tile.component.html',
  styleUrls: ['./activity-calendar-tile.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.activity-calendar-tile--auto-height]': '!fillHeight()' },
})
export class ActivityCalendarTileComponent {
  private readonly calendarService = inject(ActivityCalendarService);
  private readonly plansService = inject(TrainingPlansService);
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly router = inject(Router);
  private readonly dayDetailsNavigation = inject(CalendarDayDetailsNavigationService);
  private readonly locale = inject(LOCALE_ID);
  private readonly anchorDate = signal(startOfCurrentMonth());
  private readonly followsCurrentMonth = signal(true);
  private readonly reloadSequence = signal(0);
  private readonly today = signal(new Date());

  readonly user = input<User | null | undefined>(null);
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
    return this.plansService.watchSchedule(user.uid).pipe(
      map(schedule => ({ status: 'ready', schedule }) as ActivityCalendarTilePlansState),
      startWith({ status: 'loading', schedule: null } as ActivityCalendarTilePlansState),
      catchError(() => of({ status: 'error', schedule: null } as ActivityCalendarTilePlansState)),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  });
  readonly plansState = toSignal(toObservable(this.plansSource).pipe(switchMap(source => source)),
    { initialValue: { status: 'loading', schedule: null } as ActivityCalendarTilePlansState });
  readonly plannedWorkoutsByDate = computed<PlannedWorkoutCalendarOverlay>(() => {
    const schedule = this.plansState().schedule;
    if (!schedule) return {};
    return buildPlannedWorkoutCalendarOverlay(
      selectCalendarVisibleScheduledWorkouts(schedule),
      schedule.plans,
      schedule.state.activePlanId,
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
    if (!restoration) {
      return;
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
      this.openDay(day);
    }
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
    this.anchorDate.set(navigateActivityCalendarDate(this.anchorDate(), 'month', direction));
  }

  openDay(day: ActivityCalendarDayViewModel): void {
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
      )[day.dateKey]?.entries ?? [] : [];
    });
    const release = () => {
      subscriptions.unsubscribe();
      report?.(rangeKey, null);
    };
    try {
      subscriptions.add(this.eventsSource().subscribe(state => eventState.set(state)));
      subscriptions.add(this.plansSource().subscribe(state => plansState.set(state)));
      const sheet = this.bottomSheet.open<CalendarDayDetailsComponent, CalendarDayDetailsData, string>(CalendarDayDetailsComponent, {
        data: {
          day,
          userId,
          timelineNotes,
          activities,
          locale: this.locale,
          unitSettings: user.settings?.unitSettings ?? null,
          summariesSettings: user.settings?.summariesSettings ?? null,
          plannedWorkouts: plannedWorkouts(),
          plannedWorkoutsSource: plannedWorkouts,
          plannedWorkoutsStatusSource: () => plansState().status,
        },
      });
      sheet.afterDismissed().pipe(take(1), finalize(release)).subscribe(noteId => {
        const note = timelineNotes().find(note => note.id === noteId);
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
