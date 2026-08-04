import { ChangeDetectionStrategy, Component, HostListener, LOCALE_ID, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { DataAscent, DataDescent, DataDistance, type EventInterface } from '@sports-alliance/sports-lib';
import { formatUnitAwareDataValue } from '@shared/unit-aware-display';
import { catchError, combineLatest, distinctUntilChanged, filter, map, of, shareReplay, startWith, switchMap } from 'rxjs';
import type { AppUserInterface } from '../../../models/app-user.interface';
import { SharedModule } from '../../../modules/shared.module';
import { AppUserService } from '../../../services/app.user.service';
import { ActivityCalendarService } from '../../../services/activity-calendar.service';
import {
  type ActivityCalendarDayViewModel,
  type ActivityCalendarRouteState,
  type ActivityCalendarView,
  type ActivityCalendarVolumeMetric,
  buildActivityCalendarViewModel,
  formatActivityCalendarDateParam,
  formatActivityCalendarDuration,
  navigateActivityCalendarDate,
  normalizeActivityCalendarView,
  parseActivityCalendarDate,
  resolveActivityCalendarQueryWindow,
} from '../../../helpers/activity-calendar.helper';
import { AppActivityTypeGroupIcons } from '../../../services/color/app.activity-type-group.icons';
import { ActivityCalendarGridComponent } from '../activity-calendar-grid/activity-calendar-grid.component';
import {
  CalendarDayDetailsComponent,
  type CalendarDayDetailsData,
} from '../calendar-day-details/calendar-day-details.component';

interface CalendarEventsState {
  status: 'loading' | 'ready' | 'error';
  events: EventInterface[];
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

interface CalendarVolumeMetricOption {
  value: ActivityCalendarVolumeMetric;
  label: string;
  icon: string;
  dataType: string | null;
}

interface CalendarFamilyVolumeRow {
  id: string;
  label: string;
  icon: string;
  color: string;
  eventCountLabel: string;
  value: number;
  maximumValue: number;
  valueLabel: string;
  barPercent: number;
  hasData: boolean;
  progressLabel: string;
  ariaLabel: string;
}

const VALID_CALENDAR_VOLUME_METRICS = new Set<ActivityCalendarVolumeMetric>([
  'duration',
  'distance',
  'ascent',
  'descent',
]);

@Component({
  selector: 'app-calendar-page',
  standalone: true,
  imports: [SharedModule, ActivityCalendarGridComponent],
  templateUrl: './calendar-page.component.html',
  styleUrls: ['./calendar-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly userService = inject(AppUserService);
  private readonly calendarService = inject(ActivityCalendarService);
  private readonly bottomSheet = inject(MatBottomSheet);
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
  readonly volumeMetricOptions: ReadonlyArray<CalendarVolumeMetricOption> = [
    { value: 'duration', label: 'Duration', icon: 'schedule', dataType: null },
    { value: 'distance', label: 'Distance', icon: 'route', dataType: DataDistance.type },
    { value: 'ascent', label: 'Ascent', icon: 'trending_up', dataType: DataAscent.type },
    { value: 'descent', label: 'Descent', icon: 'trending_down', dataType: DataDescent.type },
  ];
  readonly selectedVolumeMetric = signal<ActivityCalendarVolumeMetric>('duration');
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
  readonly selectedVolumeMetricOption = computed(() => (
    this.volumeMetricOptions.find(option => option.value === this.selectedVolumeMetric())
    || this.volumeMetricOptions[0]
  ));
  readonly familyVolumeRows = computed<CalendarFamilyVolumeRow[]>(() => {
    if (this.eventState().status !== 'ready') {
      return [];
    }

    const selectedMetric = this.selectedVolumeMetricOption();
    const metric = selectedMetric.value;
    const families = this.calendarModel().summary.families;
    const maximumValue = families.reduce((maximum, family) => {
      const aggregate = family.metrics[metric];
      return aggregate.recordedEventCount > 0 ? Math.max(maximum, aggregate.value) : maximum;
    }, 0);
    const unitSettings = this.currentUser()?.settings?.unitSettings ?? null;

    return families.map((family) => {
      const aggregate = family.metrics[metric];
      const hasData = aggregate.recordedEventCount > 0;
      const isApplicable = aggregate.eligibleEventCount > 0;
      const valueLabel = !isApplicable
        ? 'N/A'
        : !hasData
          ? '--'
          : metric === 'duration'
            ? formatActivityCalendarDuration(aggregate.value)
            : formatUnitAwareDataValue(selectedMetric.dataType || undefined, aggregate.value, unitSettings, {
              stripRepeatedUnit: true,
              locale: this.locale,
            }) || `${aggregate.value}`;
      const metricStatus = !isApplicable
        ? `${selectedMetric.label} not applicable`
        : !hasData
          ? `${selectedMetric.label} unavailable`
          : `${selectedMetric.label} ${valueLabel}`;

      return {
        id: family.id,
        label: family.label,
        icon: AppActivityTypeGroupIcons[family.activityTypeGroup],
        color: family.color,
        eventCountLabel: `${family.eventCount} ${family.eventCount === 1 ? 'activity' : 'activities'}`,
        value: aggregate.value,
        maximumValue: Math.max(1, maximumValue),
        valueLabel,
        barPercent: hasData && aggregate.value > 0 && maximumValue > 0
          ? aggregate.value / maximumValue * 100
          : 0,
        hasData,
        progressLabel: `${family.label} ${selectedMetric.label}`,
        ariaLabel: `${family.label}, ${family.eventCount} ${family.eventCount === 1 ? 'activity' : 'activities'}, ${metricStatus}`,
      };
    }).sort((left, right) => (
      Number(right.hasData) - Number(left.hasData)
      || right.value - left.value
      || left.label.localeCompare(right.label)
    ));
  });
  readonly isLoading = computed(() => this.eventState().status === 'loading');
  readonly hasError = computed(() => this.eventState().status === 'error');
  readonly hasEvents = computed(() => this.calendarModel().months.some(month => (
    month.days.some(day => day.inPrimaryPeriod && day.eventCount > 0)
  )));
  readonly emptyStateLabel = computed(() => `No activities in ${this.calendarModel().periodLabel}`);

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

  selectVolumeMetric(value: unknown): void {
    const metric = `${value || ''}` as ActivityCalendarVolumeMetric;
    if (VALID_CALENDAR_VOLUME_METRICS.has(metric)) {
      this.selectedVolumeMetric.set(metric);
    }
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
    if (!day.eventCount || !userId) {
      return;
    }
    this.bottomSheet.open<CalendarDayDetailsComponent, CalendarDayDetailsData>(CalendarDayDetailsComponent, {
      data: { day, userId, locale: this.locale },
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
