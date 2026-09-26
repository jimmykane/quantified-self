import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, LOCALE_ID, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ViewportScroller } from '@angular/common';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router, Scroll } from '@angular/router';
import { DataAscent, DataDistance, type EventInterface } from '@sports-alliance/sports-lib';
import { formatUnitAwareDataValue } from '@shared/unit-aware-display';
import { catchError, combineLatest, distinctUntilChanged, filter, map, of, shareReplay, startWith, switchMap, take, type Subscription } from 'rxjs';
import type { AppUserInterface } from '../../../models/app-user.interface';
import { SharedModule } from '../../../modules/shared.module';
import { AppUserService } from '../../../services/app.user.service';
import { ActivityCalendarService } from '../../../services/activity-calendar.service';
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
import { getDateTimeFormatter } from '../../../helpers/date-time-format.helper';
import { revealCalendarDayContext } from '../../../helpers/reveal-calendar-day-context.helper';
import {
  TrainingPlansService,
  selectCalendarVisibleScheduledWorkouts,
  type CurrentTrainingScheduleV1,
} from '../../../services/training-plans.service';
import {
  type ActivityCalendarDayViewModel,
  type ActivityCalendarRouteState,
  type ActivityCalendarView,
  buildActivityCalendarViewModel,
  formatActivityCalendarDateParam,
  formatActivityCalendarDuration,
  navigateActivityCalendarDay,
  navigateActivityCalendarDate,
  normalizeActivityCalendarView,
  parseActivityCalendarDate,
  resolveActivityCalendarPrimaryRange,
  resolveActivityCalendarQueryWindow,
  resolveActivityCalendarDayRange,
} from '../../../helpers/activity-calendar.helper';
import {
  ACTIVITY_CALENDAR_VOLUME_TOOLTIP,
  buildActivityCalendarFamilyVolumeRows,
} from '../../../helpers/activity-calendar-volume.helper';
import { ActivityCalendarGridComponent } from '../activity-calendar-grid/activity-calendar-grid.component';
import { ActivityCalendarVolumeListComponent } from '../activity-calendar-volume-list/activity-calendar-volume-list.component';
import type { CalendarDayDetailsData } from '../calendar-day-details/calendar-day-details.component';
import { CalendarDayContextComponent } from '../calendar-day-context/calendar-day-context.component';
import { ActivityRangeTableSectionComponent } from '../../event-table/activity-range-table-section.component';
import { TimelineNotesWorkspaceComponent } from '../../timeline-notes/timeline-notes-workspace.component';
import { calendarTimelineNoteRange, calendarTimelineNotesByDate } from '../../../helpers/calendar-timeline-notes.helper';
import {
  buildPlannedWorkoutCalendarOverlay,
  type PlannedWorkoutCalendarOverlay,
} from '../../../helpers/planned-workout-calendar.helper';

interface CalendarEventsState {
  status: 'loading' | 'ready' | 'error';
  events: EventInterface[];
}

interface CalendarPlansState {
  status: 'loading' | 'ready' | 'error';
  schedule: CurrentTrainingScheduleV1 | null;
}

interface CalendarViewOption {
  value: ActivityCalendarView;
  label: string;
  icon: string;
}

interface CalendarSummaryMetric {
  label: string;
  icon: string;
  value: string;
}

@Component({
  selector: 'app-calendar-page',
  standalone: true,
  imports: [
    SharedModule,
    ActivityCalendarGridComponent,
    CalendarDayContextComponent,
    ActivityCalendarVolumeListComponent,
    ActivityRangeTableSectionComponent,
    TimelineNotesWorkspaceComponent,
  ],
  templateUrl: './calendar-page.component.html',
  styleUrls: ['./calendar-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly viewportScroller = inject(ViewportScroller);
  private readonly destroyRef = inject(DestroyRef);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private pendingScrollRestore: Subscription | null = null;
  private readonly userService = inject(AppUserService);
  private readonly calendarService = inject(ActivityCalendarService);
  private readonly plansService = inject(TrainingPlansService);
  private readonly dayDetailsNavigation = inject(CalendarDayDetailsNavigationService);
  private readonly locale = inject(LOCALE_ID);
  private readonly notesWorkspace = viewChild(TimelineNotesWorkspaceComponent);
  private readonly reloadSequence = signal(0);
  private readonly today = signal(new Date());
  readonly isDayRoute = this.route.snapshot.data?.['calendarMode'] === 'day';
  private readonly initialRouteState = resolveRouteState(
    this.route.snapshot.queryParamMap,
    this.isDayRoute ? this.route.snapshot.paramMap.get('date') : null,
  );
  private readonly routeState$ = combineLatest([this.route.queryParamMap, this.route.paramMap]).pipe(
    map(([queryParams, routeParams]) => resolveRouteState(
      queryParams, this.isDayRoute ? routeParams.get('date') : null,
    )),
    distinctUntilChanged((previous, current) => (
      previous.view === current.view
      && formatActivityCalendarDateParam(previous.anchorDate) === formatActivityCalendarDateParam(current.anchorDate)
    )),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly viewOptions: ReadonlyArray<CalendarViewOption> = [
    { value: 'week', label: 'Week', icon: 'view_week' },
    { value: 'month', label: 'Month', icon: 'calendar_view_month' },
    { value: 'year', label: 'Year', icon: 'calendar_month' },
  ];
  readonly familyVolumeTooltip = ACTIVITY_CALENDAR_VOLUME_TOOLTIP;
  readonly routeState = toSignal(this.routeState$, { initialValue: this.initialRouteState });
  private readonly explicitDateParam = toSignal(this.route.queryParamMap.pipe(map(params => params.get('date'))), {
    initialValue: this.route.snapshot.queryParamMap.get('date'),
  });
  private readonly dayRouteDateParam = toSignal(this.route.paramMap.pipe(map(params => params.get('date'))), {
    initialValue: this.route.snapshot.paramMap.get('date'),
  });
  readonly currentUser = computed(() => this.userService.user() as AppUserInterface | null);
  readonly hasTrainingPlanningUIAccess = computed(() => !!this.currentUser()?.uid);
  readonly eventState = toSignal(combineLatest([
    this.userService.user$,
    this.routeState$,
    toObservable(this.reloadSequence),
  ]).pipe(
    switchMap(([user, state]) => {
      if (!user?.uid) return of({ status: 'ready', events: [] } as CalendarEventsState);
      const startOfWeek = user.settings?.unitSettings?.startOfTheWeek;
      const queryWindow = this.isDayRoute
        ? resolveActivityCalendarDayRange(state.anchorDate)
        : resolveActivityCalendarQueryWindow(state.view, state.anchorDate, startOfWeek);
      return this.calendarService.watchEvents(user, queryWindow).pipe(
        map(events => ({ status: 'ready', events }) as CalendarEventsState),
        startWith({ status: 'loading', events: [] } as CalendarEventsState),
        catchError(() => of({ status: 'error', events: [] } as CalendarEventsState)),
      );
    }),
  ), { initialValue: { status: 'loading', events: [] } as CalendarEventsState });
  readonly plansState = toSignal(this.userService.user$.pipe(
    switchMap(user => user?.uid
      ? this.plansService.watchSchedule(user.uid).pipe(
        map(schedule => ({ status: 'ready', schedule }) as CalendarPlansState),
        startWith({ status: 'loading', schedule: null } as CalendarPlansState),
        catchError(() => of({ status: 'error', schedule: null } as CalendarPlansState)),
      )
      : of({ status: 'ready', schedule: null } as CalendarPlansState)),
  ), { initialValue: { status: 'loading', schedule: null } as CalendarPlansState });
  readonly workoutCompletions = toSignal(this.userService.user$.pipe(
    switchMap(user => user?.uid
      ? this.plansService.watchWorkoutCompletions(user.uid).pipe(
        startWith([]),
        catchError(() => of([])),
      )
      : of([])),
  ), { initialValue: [] });
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
  readonly calendarModel = computed(() => {
    const state = this.routeState();
    return buildActivityCalendarViewModel(this.eventState().events, {
      view: state.view,
      anchorDate: state.anchorDate,
      startOfWeek: this.currentUser()?.settings?.unitSettings?.startOfTheWeek,
      summariesSettings: this.currentUser()?.settings?.summariesSettings,
      locale: this.locale,
      now: this.today(),
    });
  });
  readonly primaryActivityRange = computed(() => this.isDayRoute
    ? resolveActivityCalendarDayRange(this.routeState().anchorDate)
    : resolveActivityCalendarPrimaryRange(
      this.routeState().view,
      this.routeState().anchorDate,
      this.currentUser()?.settings?.unitSettings?.startOfTheWeek,
    ));
  readonly timelineNoteRange = computed(() => this.isDayRoute
    ? { startDate: formatActivityCalendarDateParam(this.routeState().anchorDate),
      endDate: formatActivityCalendarDateParam(this.routeState().anchorDate) }
    : calendarTimelineNoteRange(this.calendarModel()));
  readonly notesByDate = computed(() => {
    const workspace = this.notesWorkspace();
    const notes = this.currentUser()?.uid === workspace?.service.uid() ? workspace?.context().notes ?? [] : [];
    return calendarTimelineNotesByDate(this.calendarModel(), notes, this.today().getTime());
  });
  readonly periodSummaryMetrics = computed<CalendarSummaryMetric[]>(() => {
    if (this.eventState().status !== 'ready') {
      return [
        { label: 'Distance', icon: 'route', value: '--' },
        { label: 'Duration', icon: 'schedule', value: '--' },
        { label: 'Ascent', icon: 'landscape', value: '--' },
      ];
    }

    const summary = this.calendarModel().summary;
    const unitSettings = this.currentUser()?.settings?.unitSettings ?? null;
    return [
      {
        label: 'Distance',
        icon: 'route',
        value: formatUnitAwareDataValue(DataDistance.type, summary.totalDistanceMeters, unitSettings, {
          stripRepeatedUnit: true,
          locale: this.locale,
        }) || '0',
      },
      {
        label: 'Duration',
        icon: 'schedule',
        value: formatActivityCalendarDuration(summary.totalDurationSeconds),
      },
      {
        label: 'Ascent',
        icon: 'landscape',
        value: formatUnitAwareDataValue(DataAscent.type, summary.totalAscentMeters, unitSettings, {
          stripRepeatedUnit: true,
          locale: this.locale,
        }) || '0',
      },
    ];
  });
  readonly familyVolumeRows = computed(() => {
    if (this.eventState().status !== 'ready') {
      return [];
    }

    return buildActivityCalendarFamilyVolumeRows(
      this.calendarModel().summary,
      this.currentUser()?.settings?.unitSettings ?? null,
      this.locale,
    );
  });
  readonly isLoading = computed(() => this.eventState().status === 'loading');
  readonly hasError = computed(() => this.eventState().status === 'error');
  readonly hasEvents = computed(() => this.calendarModel().months.some(month => (
    month.days.some(day => day.inPrimaryPeriod && day.eventCount > 0)
  )));
  readonly emptyStateLabel = computed(() => this.isDayRoute
    ? 'No completed activities for this day'
    : `No completed activities in ${this.calendarModel().periodLabel}`);
  readonly dayTitle = computed(() => getDateTimeFormatter(this.locale, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  }).format(this.routeState().anchorDate));
  readonly dayShortTitle = computed(() => getDateTimeFormatter(this.locale, {
    day: 'numeric', month: 'short', year: '2-digit',
  }).format(this.routeState().anchorDate));
  readonly calendarBackQuery = computed(() => ({
    view: 'month', date: formatActivityCalendarDateParam(this.routeState().anchorDate),
  }));
  readonly selectedDay = computed(() => {
    const dateKey = formatActivityCalendarDateParam(this.routeState().anchorDate);
    return this.calendarModel().months.flatMap(month => month.days)
      .find(day => day.dateKey === dateKey)
      ?? this.calendarModel().months.flatMap(month => month.days).find(day => day.inPrimaryPeriod)
      ?? null;
  });
  readonly selectedDayActivities = computed(() => ({
    day: this.selectedDay()!, status: this.eventState().status,
  }));
  readonly selectedDayNotes = computed(() => this.notesByDate().get(this.selectedDay()?.dateKey || '')?.notes ?? []);
  readonly selectedDayPlanned = computed(() => this.plannedWorkoutsByDate()[this.selectedDay()?.dateKey || '']?.entries ?? []);
  readonly selectedDayData = computed<CalendarDayDetailsData | null>(() => {
    const day = this.selectedDay();
    const user = this.currentUser();
    if (!day || !user?.uid) return null;
    return {
      day, userId: user.uid, locale: this.locale,
      planningEnabled: this.hasTrainingPlanningUIAccess(),
      unitSettings: user.settings?.unitSettings ?? null,
      summariesSettings: user.settings?.summariesSettings ?? null,
      timelineNotes: this.selectedDayNotes,
      activities: this.selectedDayActivities,
      plannedWorkoutsSource: this.selectedDayPlanned,
      plannedWorkoutsStatusSource: () => this.plansState().status,
      scheduleSource: () => this.currentUser()?.uid === user.uid ? this.plansState().schedule : null,
    };
  });
  private readonly restoreDayDetailsEffect = effect(() => {
    const restoration = this.dayDetailsNavigation.restorationFor(this.router.url);
    if (!restoration || this.eventState().status !== 'ready') {
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
    if (day && this.selectedDay()?.dateKey !== day.dateKey) this.openDay(day, false);
  });
  private readonly openDuplicatedDayEffect = effect(() => {
    const uid = this.currentUser()?.uid;
    if (!uid) return;
    const dateKey = this.dayDetailsNavigation.workoutDestinationFor(uid);
    if (!dateKey || formatActivityCalendarDateParam(this.routeState().anchorDate) !== dateKey
      || this.eventState().status === 'loading') return;
    const day = this.calendarModel().months.flatMap(month => month.days)
      .find(candidate => candidate.dateKey === dateKey);
    if (day) this.dayDetailsNavigation.consumeWorkoutDestination(uid, dateKey);
  });
  private readonly canonicalDayRouteEffect = effect(() => {
    if (!this.isDayRoute) return;
    const routeDate = this.dayRouteDateParam();
    const canonicalDate = formatActivityCalendarDateParam(parseActivityCalendarDate(routeDate));
    if (routeDate !== canonicalDate) {
      void this.router.navigate(['/calendar/day', canonicalDate], { replaceUrl: true });
    }
  });

  @HostListener('window:focus')
  refreshToday(): void {
    this.today.set(new Date());
  }

  @HostListener('document:visibilitychange')
  refreshVisibleToday(): void {
    // Mobile tab/app resumes need not emit window focus. Keep ongoing note cutoffs current too.
    if (document.visibilityState === 'visible') this.refreshToday();
  }

  selectView(value: unknown): void {
    const view = normalizeActivityCalendarView(value, this.routeState().view);
    if (view === this.routeState().view) {
      return;
    }
    this.navigateToState({ ...this.routeState(), view });
  }

  navigatePeriod(direction: -1 | 1): void {
    const state = this.routeState();
    if (this.isDayRoute) {
      this.navigateToState({ ...state, anchorDate: navigateActivityCalendarDay(state.anchorDate, direction) });
      return;
    }
    this.navigateToState({
      ...state,
      anchorDate: navigateActivityCalendarDate(state.anchorDate, state.view, direction),
    });
  }

  goToToday(): void {
    this.navigateToState({ ...this.routeState(), anchorDate: new Date() });
  }

  retry(): void {
    this.reloadSequence.update(value => value + 1);
  }

  openDay(day: ActivityCalendarDayViewModel, revealDay = true): void {
    const state = this.routeState();
    const isNarrowYear = revealDay && state.view === 'year'
      && this.elementRef.nativeElement.ownerDocument.defaultView?.matchMedia?.('(max-width: 900px)')?.matches;
    if (!this.currentUser()?.uid || (!isNarrowYear
      && this.selectedDay()?.dateKey === day.dateKey && this.explicitDateParam() === day.dateKey)) return;
    this.navigateToState({ ...state, view: isNarrowYear ? 'month' : state.view, anchorDate: day.date }, revealDay);
  }

  selectDayNote(noteId: string): void {
    const note = this.selectedDayNotes().find(candidate => candidate.id === noteId);
    if (note && this.currentUser()?.uid === this.notesWorkspace()?.service.uid()) {
      this.notesWorkspace()?.context().select([note]);
    }
  }

  private navigateToState(state: ActivityCalendarRouteState, revealDay = false): void {
    if (this.isDayRoute) {
      void this.router.navigate(['/calendar/day', formatActivityCalendarDateParam(state.anchorDate)]);
      return;
    }
    const viewChanged = state.view !== this.routeState().view;
    const scrollPosition = this.viewportScroller.getScrollPosition();
    const targetDate = formatActivityCalendarDateParam(state.anchorDate);
    this.pendingScrollRestore?.unsubscribe();
    // The app router scrolls to the top after query-only navigation. Restore the
    // current position after its Scroll event so selecting a day stays in context.
    const scrollRestore = this.router.events.pipe(
      filter((event): event is Scroll => {
        if (!(event instanceof Scroll)) return false;
        const url = 'urlAfterRedirects' in event.routerEvent
          ? event.routerEvent.urlAfterRedirects : event.routerEvent.url;
        const params = this.router.parseUrl(url).queryParamMap;
        return params.get('view') === state.view && params.get('date') === targetDate;
      }),
      take(1),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(event => {
      if (this.pendingScrollRestore === scrollRestore) this.pendingScrollRestore = null;
      if (event.position) return; // Browser Back already restores its saved position.
      Promise.resolve().then(() => {
        if (this.destroyRef.destroyed) return;
        if (!viewChanged) this.viewportScroller.scrollToPosition(scrollPosition);
        if (revealDay) requestAnimationFrame(() => {
          if (!this.destroyRef.destroyed) revealCalendarDayContext(this.elementRef.nativeElement);
        });
      });
    });
    this.pendingScrollRestore = scrollRestore;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        view: state.view,
        date: targetDate,
      },
      queryParamsHandling: 'merge',
    }).then(navigated => {
      if (!navigated && this.pendingScrollRestore === scrollRestore) {
        scrollRestore.unsubscribe();
        this.pendingScrollRestore = null;
      }
    }).catch(() => {
      if (this.pendingScrollRestore === scrollRestore) {
        scrollRestore.unsubscribe();
        this.pendingScrollRestore = null;
      }
    });
  }
}

function resolveRouteState(params: ParamMap, pathDate: string | null = null): ActivityCalendarRouteState {
  return {
    view: pathDate === null ? normalizeActivityCalendarView(params.get('view')) : 'month',
    anchorDate: parseActivityCalendarDate(pathDate ?? params.get('date')),
  };
}
