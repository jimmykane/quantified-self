import { ChangeDetectionStrategy, Component, HostListener, LOCALE_ID, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { DataAscent, DataDistance, type EventInterface } from '@sports-alliance/sports-lib';
import { formatUnitAwareDataValue } from '@shared/unit-aware-display';
import { catchError, combineLatest, distinctUntilChanged, filter, map, of, shareReplay, startWith, switchMap } from 'rxjs';
import type { AppUserInterface } from '../../../models/app-user.interface';
import { SharedModule } from '../../../modules/shared.module';
import { AppUserService } from '../../../services/app.user.service';
import { ActivityCalendarService } from '../../../services/activity-calendar.service';
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
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
  navigateActivityCalendarDate,
  normalizeActivityCalendarView,
  parseActivityCalendarDate,
  resolveActivityCalendarPrimaryRange,
  resolveActivityCalendarQueryWindow,
} from '../../../helpers/activity-calendar.helper';
import {
  ACTIVITY_CALENDAR_VOLUME_TOOLTIP,
  buildActivityCalendarFamilyVolumeRows,
} from '../../../helpers/activity-calendar-volume.helper';
import { ActivityCalendarGridComponent } from '../activity-calendar-grid/activity-calendar-grid.component';
import { ActivityCalendarVolumeListComponent } from '../activity-calendar-volume-list/activity-calendar-volume-list.component';
import {
  CalendarDayDetailsComponent,
  type CalendarDayDetailsData,
} from '../calendar-day-details/calendar-day-details.component';
import { ActivityRangeTableSectionComponent } from '../../event-table/activity-range-table-section.component';
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
    ActivityCalendarVolumeListComponent,
    ActivityRangeTableSectionComponent,
  ],
  templateUrl: './calendar-page.component.html',
  styleUrls: ['./calendar-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly userService = inject(AppUserService);
  private readonly calendarService = inject(ActivityCalendarService);
  private readonly plansService = inject(TrainingPlansService);
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly dayDetailsNavigation = inject(CalendarDayDetailsNavigationService);
  private readonly locale = inject(LOCALE_ID);
  private readonly reloadSequence = signal(0);
  private readonly today = signal(new Date());
  private readonly initialRouteState = resolveRouteState(this.route.snapshot.queryParamMap);
  private readonly routeState$ = this.route.queryParamMap.pipe(
    map(params => resolveRouteState(params)),
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
  readonly currentUser = computed(() => this.userService.user() as AppUserInterface | null);
  readonly eventState = toSignal(combineLatest([
    this.userService.user$.pipe(
      filter((user): user is AppUserInterface => !!user?.uid),
    ),
    this.routeState$,
    toObservable(this.reloadSequence),
  ]).pipe(
    switchMap(([user, state]) => {
      const startOfWeek = user.settings?.unitSettings?.startOfTheWeek;
      const queryWindow = resolveActivityCalendarQueryWindow(state.view, state.anchorDate, startOfWeek);
      return this.calendarService.watchEvents(user, queryWindow).pipe(
        map(events => ({ status: 'ready', events }) as CalendarEventsState),
        startWith({ status: 'loading', events: [] } as CalendarEventsState),
        catchError(() => of({ status: 'error', events: [] } as CalendarEventsState)),
      );
    }),
  ), { initialValue: { status: 'loading', events: [] } as CalendarEventsState });
  readonly plansState = toSignal(this.userService.user$.pipe(
    filter((user): user is AppUserInterface => !!user?.uid),
    switchMap(user => this.plansService.watchSchedule(user.uid).pipe(
      map(schedule => ({ status: 'ready', schedule }) as CalendarPlansState),
      startWith({ status: 'loading', schedule: null } as CalendarPlansState),
      catchError(() => of({ status: 'error', schedule: null } as CalendarPlansState)),
    )),
  ), { initialValue: { status: 'loading', schedule: null } as CalendarPlansState });
  readonly plannedWorkoutsByDate = computed<PlannedWorkoutCalendarOverlay>(() => {
    const schedule = this.plansState().schedule;
    if (!schedule) return {};
    return buildPlannedWorkoutCalendarOverlay(
      selectCalendarVisibleScheduledWorkouts(schedule),
      schedule.plans,
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
  readonly primaryActivityRange = computed(() => resolveActivityCalendarPrimaryRange(
    this.routeState().view,
    this.routeState().anchorDate,
    this.currentUser()?.settings?.unitSettings?.startOfTheWeek,
  ));
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
  readonly emptyStateLabel = computed(() => `No completed activities in ${this.calendarModel().periodLabel}`);
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
    if (day) {
      this.openDay(day);
    }
  });

  @HostListener('window:focus')
  refreshToday(): void {
    this.today.set(new Date());
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

  openDay(day: ActivityCalendarDayViewModel): void {
    const userId = `${this.currentUser()?.uid || ''}`.trim();
    if (!userId) {
      return;
    }
    this.bottomSheet.open<CalendarDayDetailsComponent, CalendarDayDetailsData>(CalendarDayDetailsComponent, {
      data: {
        day,
        userId,
        locale: this.locale,
        unitSettings: this.currentUser()?.settings?.unitSettings ?? null,
        summariesSettings: this.currentUser()?.settings?.summariesSettings ?? null,
        plannedWorkouts: this.plannedWorkoutsByDate()[day.dateKey]?.entries ?? [],
      },
    });
  }

  private navigateToState(state: ActivityCalendarRouteState): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        view: state.view,
        date: formatActivityCalendarDateParam(state.anchorDate),
      },
      queryParamsHandling: 'merge',
    });
  }
}

function resolveRouteState(params: ParamMap): ActivityCalendarRouteState {
  return {
    view: normalizeActivityCalendarView(params.get('view')),
    anchorDate: parseActivityCalendarDate(params.get('date')),
  };
}
