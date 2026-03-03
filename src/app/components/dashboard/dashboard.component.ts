import { Component, DestroyRef, OnChanges, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppEventService } from '../../services/app.event.service';
import { merge, of, Subject } from 'rxjs';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserInterface } from '../../models/app-user.interface';
import { DateRanges } from '@sports-alliance/sports-lib';
import { Search } from '../event-search/event-search.component';
import { AppUserService } from '../../services/app.user.service';
import { DaysOfTheWeek } from '@sports-alliance/sports-lib';
import { distinctUntilChanged, filter, map, switchMap, take, tap } from 'rxjs/operators';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { LoggerService } from '../../services/logger.service';

import { getDatesForDateRange } from '../../helpers/date-range-helper';
import { WhereFilterOp } from 'firebase/firestore';


@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  standalone: false
})

export class DashboardComponent implements OnInit, OnDestroy, OnChanges {
  public user: AppUserInterface;
  public targetUser: AppUserInterface;
  public events: EventInterface[];
  public searchTerm: string;
  public searchStartDate: Date;
  public searchEndDate: Date;
  public startOfTheWeek: DaysOfTheWeek;
  public isLoading: boolean;
  public showUpload = false;
  public isInitialized = false;
  public hasMergedEvents = false;

  private shouldSearch: boolean;
  private manualSearchTrigger$ = new Subject<AppUserInterface | null>();
  private initialLiveReconcilePending = false;
  private initialResolvedEventsForReconcile: EventInterface[] = [];
  private initialResolvedUserIDForReconcile: string | null = null;
  private analyticsService = inject(AppAnalyticsService);
  private logger = inject(LoggerService);
  private destroyRef = inject(DestroyRef);


  constructor(public authService: AppAuthService,
    private router: Router,
    private eventService: AppEventService,
    private userService: AppUserService,
    private route: ActivatedRoute,
    private snackBar: MatSnackBar) {
  }

  async ngOnInit() {
    const initStart = performance.now();

    const resolvedData = this.route.snapshot.data['dashboardData'];
    if (resolvedData) {
      const resolvedDataStart = performance.now();
      this.events = resolvedData.events || [];
      this.user = resolvedData.user;
      this.initialLiveReconcilePending = !!resolvedData.user;
      this.initialResolvedEventsForReconcile = this.events || [];
      this.initialResolvedUserIDForReconcile = resolvedData.user?.uid || null;
      this.targetUser = resolvedData.targetUser;
      this.hasMergedEvents = resolvedData.hasMergedEvents ?? this.events?.some(event => event.isMerge) ?? false;
      this.isLoading = false;
      this.isInitialized = true;


      if (this.user) {
        if (this.user.settings.dashboardSettings.dateRange === DateRanges.custom && this.user.settings.dashboardSettings.startDate && this.user.settings.dashboardSettings.endDate) {
          this.searchStartDate = new Date(this.user.settings.dashboardSettings.startDate);
          this.searchEndDate = new Date(this.user.settings.dashboardSettings.endDate);
        } else if (this.user.settings.unitSettings?.startOfTheWeek !== undefined) {
          const range = getDatesForDateRange(this.user.settings.dashboardSettings.dateRange, this.user.settings.unitSettings.startOfTheWeek);
          this.searchStartDate = range.startDate;
          this.searchEndDate = range.endDate;
        }
        this.startOfTheWeek = this.user.settings.unitSettings?.startOfTheWeek;
      }
      this.logPerf('resolved_dashboard_data', resolvedDataStart, { events: this.events?.length || 0 });
    }

    this.shouldSearch = false;

    // @todo make this an obsrvbl
    const userID = this.route.snapshot.paramMap.get('userID');
    if (userID && !this.targetUser) { // Only fetch if not resolved
      const targetUserFetchStart = performance.now();
      try {
        this.targetUser = await this.userService.getUserByID(userID).pipe(take(1)).toPromise();
        this.logPerf('target_user_fetch', targetUserFetchStart, { userID });
      } catch (e) {
        return this.router.navigate(['dashboard']).then(() => {
          this.snackBar.open('Page not found');
        });
      }
    }
    merge(this.authService.user$, this.manualSearchTrigger$).pipe(
      map((user: AppUserInterface | null) => ({
        user,
        eventsListenerKey: this.getEventsListenerKey(user),
      })),
      distinctUntilChanged((previous, current) => previous.eventsListenerKey === current.eventsListenerKey),
      map(({ user }) => user),
      switchMap((user: AppUserInterface | null) => {
      const userEmissionStart = performance.now();

      if (this.shouldSearch || !this.isInitialized) {
        this.isLoading = true;
      }

      // Get the user
      if (!user) {
        this.router.navigate(['login']).then(() => {
          this.snackBar.open('You were signed out out')
        });
        return of({ user: null, events: null });
      }


      if (this.user && (
        this.user.settings.dashboardSettings.dateRange !== user.settings.dashboardSettings.dateRange
        || this.user.settings.dashboardSettings.startDate !== user.settings.dashboardSettings.startDate
        || this.user.settings.dashboardSettings.endDate !== user.settings.dashboardSettings.endDate
        || (this.user.settings.dashboardSettings.includeMergedEvents !== false) !== (user.settings.dashboardSettings.includeMergedEvents !== false)
        || this.user.settings.unitSettings.startOfTheWeek !== user.settings.unitSettings.startOfTheWeek
      )) {
        this.shouldSearch = true;
      }

      // Setup the ranges to search depending on pref
      if (user.settings.dashboardSettings.dateRange === DateRanges.custom && user.settings.dashboardSettings.startDate && user.settings.dashboardSettings.endDate) {
        this.searchStartDate = new Date(user.settings.dashboardSettings.startDate);
        this.searchEndDate = new Date(user.settings.dashboardSettings.endDate);
      } else {
        this.searchStartDate = getDatesForDateRange(user.settings.dashboardSettings.dateRange, user.settings.unitSettings.startOfTheWeek).startDate;
        this.searchEndDate = getDatesForDateRange(user.settings.dashboardSettings.dateRange, user.settings.unitSettings.startOfTheWeek).endDate;
      }

      this.startOfTheWeek = user.settings.unitSettings.startOfTheWeek;

      const limit = 0; // @todo double check this how it relates
      const where = [];
      const includeMergedEvents = user.settings.dashboardSettings.includeMergedEvents !== false;
      if (this.searchTerm) {
        where.push({
          fieldPath: 'name',
          opStr: <WhereFilterOp>'==',
          value: this.searchTerm
        });
      }

      if ((!this.searchStartDate || !this.searchEndDate) && user.settings.dashboardSettings.dateRange === DateRanges.custom) {
        return of({ events: [], user: user })
      }



      if (user.settings.dashboardSettings.dateRange !== DateRanges.all) {
        // this.searchStartDate.setHours(0, 0, 0, 0); // @todo this should be moved to the search component
        where.push({
          fieldPath: 'startDate',
          opStr: <WhereFilterOp>'>=',
          value: this.searchStartDate.getTime() // Should remove mins from date
        });
        // this.searchEndDate.setHours(24, 0, 0, 0);
        where.push({
          fieldPath: 'startDate',
          opStr: <WhereFilterOp>'<=', // Should remove mins from date
          value: this.searchEndDate.getTime()
        });
      }

      // Use the live listener but ensure we don't emit redundant data if it matches what we already have
      return this.eventService
        .getEventsBy(this.targetUser ? this.targetUser : user, where, 'startDate', false, limit)
        .pipe(
          distinctUntilChanged((p: EventInterface[], c: EventInterface[]) => this.areEventsEquivalentByIdentity(p, c)),
          map((eventsArray: EventInterface[]) => {
            if (this.initialLiveReconcilePending && this.initialResolvedUserIDForReconcile !== user.uid) {
              this.initialLiveReconcilePending = false;
            }

            const shouldAttemptInitialReconcile = this.initialLiveReconcilePending
              && this.initialResolvedUserIDForReconcile === user.uid
              && !this.shouldSearch;

            if (shouldAttemptInitialReconcile) {
              this.initialLiveReconcilePending = false;
              const isDuplicateOfResolvedData = this.areEventsEquivalentByIdentity(this.initialResolvedEventsForReconcile, eventsArray);
              if (isDuplicateOfResolvedData) {
                this.logger.info('[perf] dashboard_skip_initial_live_duplicate', {
                  events: eventsArray?.length || 0,
                  userID: user.uid,
                });
                return { eventsArray, skipInitialStateUpdate: true };
              }
            }

            return { eventsArray, skipInitialStateUpdate: false };
          }),
          tap(({ eventsArray, skipInitialStateUpdate }) => {
            if (skipInitialStateUpdate) {
              return;
            }
            this.logPerf('events_listener_emit', userEmissionStart, { incomingEvents: eventsArray?.length || 0 });
            this.hasMergedEvents = eventsArray.some(event => event.isMerge);
          }),
          map(({ eventsArray, skipInitialStateUpdate }) => {
            if (skipInitialStateUpdate) {
              return null;
            }
            const filterStart = performance.now();
            let filteredEvents = eventsArray;
            if (!includeMergedEvents) {
              filteredEvents = filteredEvents.filter(event => !event.isMerge);
            }
            if (!user.settings.dashboardSettings.activityTypes || !user.settings.dashboardSettings.activityTypes.length) {
              this.logPerf('events_filtering', filterStart, {
                includeMergedEvents,
                activityTypeFilters: 0,
                resultCount: filteredEvents.length,
              });
              return filteredEvents;
            }
            const result = filteredEvents.filter(event => {
              const hasType = event.getActivityTypesAsArray().some(activityType => user.settings.dashboardSettings.activityTypes.indexOf(ActivityTypes[activityType]) >= 0);
              return hasType;
            });
            this.logPerf('events_filtering', filterStart, {
              includeMergedEvents,
              activityTypeFilters: user.settings.dashboardSettings.activityTypes.length,
              resultCount: result.length,
            });
            return result;
          }),
          filter((eventsArray: EventInterface[] | null): eventsArray is EventInterface[] => eventsArray !== null),
          map((events) => {
            return { events: events, user: user }
          }))
    }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((eventsAndUser) => {

      this.shouldSearch = false;
      this.events = eventsAndUser.events || [];
      this.user = eventsAndUser.user;
      this.isLoading = false;
      this.isInitialized = true;
      this.logger.info('[perf] dashboard_state_update', { events: this.events.length });

    });
    this.logPerf('dashboard_init', initStart);
  }

  async search(search: Search) {
    if (!this.user?.settings?.dashboardSettings) {
      return;
    }

    const previousSearchState = {
      searchTerm: this.searchTerm,
      searchStartDate: this.searchStartDate,
      searchEndDate: this.searchEndDate,
    };
    const previousDashboardSettings = {
      includeMergedEvents: this.user.settings.dashboardSettings.includeMergedEvents,
      dateRange: this.user.settings.dashboardSettings.dateRange,
      startDate: this.user.settings.dashboardSettings.startDate,
      endDate: this.user.settings.dashboardSettings.endDate,
      activityTypes: this.user.settings.dashboardSettings.activityTypes,
    };

    this.isLoading = true;
    this.shouldSearch = true;
    this.searchTerm = search.searchTerm;
    this.searchStartDate = search.startDate;
    this.searchEndDate = search.endDate;

    try {
      this.user.settings.dashboardSettings.includeMergedEvents = search.includeMergedEvents !== false;
      this.user.settings.dashboardSettings.dateRange = search.dateRange;
      this.user.settings.dashboardSettings.startDate = search.startDate && search.startDate.getTime();
      this.user.settings.dashboardSettings.endDate = search.endDate && search.endDate.getTime();
      this.user.settings.dashboardSettings.activityTypes = search.activityTypes;
      this.manualSearchTrigger$.next(this.user);
      this.analyticsService.logEvent('dashboard_search', { method: DateRanges[search.dateRange] });
      await this.userService.updateUserProperties(this.user, { settings: this.user.settings });
    } catch (error) {
      this.searchTerm = previousSearchState.searchTerm;
      this.searchStartDate = previousSearchState.searchStartDate;
      this.searchEndDate = previousSearchState.searchEndDate;
      this.user.settings.dashboardSettings.includeMergedEvents = previousDashboardSettings.includeMergedEvents;
      this.user.settings.dashboardSettings.dateRange = previousDashboardSettings.dateRange;
      this.user.settings.dashboardSettings.startDate = previousDashboardSettings.startDate;
      this.user.settings.dashboardSettings.endDate = previousDashboardSettings.endDate;
      this.user.settings.dashboardSettings.activityTypes = previousDashboardSettings.activityTypes;
      this.shouldSearch = false;
      this.isLoading = false;
      this.snackBar.open('Could not update dashboard filters');
      this.logger.error('[DashboardComponent] Failed to persist dashboard search filters', error);
    }
  }

  ngOnChanges() {

  }



  ngOnDestroy(): void {
    this.manualSearchTrigger$.complete();
  }

  private logPerf(step: string, start: number, meta?: Record<string, unknown>) {
    this.logger.info(`[perf] dashboard_${step}`, {
      durationMs: Number((performance.now() - start).toFixed(2)),
      ...(meta || {}),
    });
  }

  private areEventsEquivalentByIdentity(previousEvents: EventInterface[] = [], currentEvents: EventInterface[] = []): boolean {
    if (previousEvents?.length !== currentEvents?.length) {
      return false;
    }
    return previousEvents.every((previousEvent, index) => {
      const currentEvent = currentEvents[index];
      return this.getEventStableID(previousEvent) === this.getEventStableID(currentEvent)
        && previousEvent?.name === currentEvent?.name
        && this.getEventStableStartDate(previousEvent) === this.getEventStableStartDate(currentEvent);
    });
  }

  private getEventStableID(event: EventInterface | undefined): string | null {
    if (!event) {
      return null;
    }
    const eventAny = event as any;
    if (typeof eventAny.getID === 'function') {
      return eventAny.getID();
    }
    return eventAny.id || null;
  }

  private getEventStableStartDate(event: EventInterface | undefined): number | null {
    if (!event) {
      return null;
    }
    const startDate = (event as any).startDate;
    if (startDate instanceof Date) {
      return startDate.getTime();
    }
    if (startDate && typeof startDate.getTime === 'function') {
      return startDate.getTime();
    }
    if (typeof startDate === 'number') {
      return startDate;
    }
    return null;
  }

  private getEventsListenerKey(user: AppUserInterface | null): string {
    if (!user) {
      return 'anonymous';
    }

    const dashboardSettings = user.settings?.dashboardSettings;
    const activityTypes = Array.isArray(dashboardSettings?.activityTypes)
      ? [...dashboardSettings.activityTypes].sort((left, right) => `${left}`.localeCompare(`${right}`))
      : [];

    return JSON.stringify({
      queryUserID: this.targetUser?.uid || user.uid,
      dateRange: dashboardSettings?.dateRange ?? null,
      startDate: dashboardSettings?.startDate ?? null,
      endDate: dashboardSettings?.endDate ?? null,
      includeMergedEvents: dashboardSettings?.includeMergedEvents !== false,
      activityTypes,
      startOfTheWeek: user.settings?.unitSettings?.startOfTheWeek ?? null,
      searchTerm: this.searchTerm || null,
    });
  }
}
