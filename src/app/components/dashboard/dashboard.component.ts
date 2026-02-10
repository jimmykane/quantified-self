import { Component, OnChanges, OnDestroy, OnInit, inject } from '@angular/core';
import { AppEventService } from '../../services/app.event.service';
import { of, Subscription } from 'rxjs';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserInterface } from '../../models/app-user.interface';
import { DateRanges } from '@sports-alliance/sports-lib';
import { Search } from '../event-search/event-search.component';
import { AppUserService } from '../../services/app.user.service';
import { DaysOfTheWeek } from '@sports-alliance/sports-lib';
import { distinctUntilChanged, map, switchMap, take, tap } from 'rxjs/operators';
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
  public dataSubscription: Subscription;
  public searchTerm: string;
  public searchStartDate: Date;
  public searchEndDate: Date;
  public startOfTheWeek: DaysOfTheWeek;
  public isLoading: boolean;
  public showUpload = false;
  public isInitialized = false;
  public hasMergedEvents = false;

  private shouldSearch: boolean;
  private hasResolvedDataForInitialRender = false;
  private analyticsService = inject(AppAnalyticsService);
  private logger = inject(LoggerService);


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
      this.hasResolvedDataForInitialRender = !!resolvedData.user;
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
    this.dataSubscription = this.authService.user$.pipe(switchMap((user: AppUserInterface | null) => {
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

      // Resolver already loaded the same dataset once; skip duplicate live query on first paint.
      if (
        this.hasResolvedDataForInitialRender
        && !this.shouldSearch
        && this.isInitialized
        && this.user?.uid === user.uid
      ) {
        this.hasResolvedDataForInitialRender = false;
        this.logger.info('[perf] dashboard_skip_initial_live_query', {
          events: this.events?.length || 0,
          userID: user.uid,
        });
        return of({ events: this.events || [], user });
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
          distinctUntilChanged((p: EventInterface[], c: EventInterface[]) => {
            if (p?.length !== c?.length) return false;
            return p.every((event, index) => {
              const prev = p[index];
              const curr = c[index];
              return prev.getID() === curr.getID() &&
                prev.name === curr.name &&
                prev.startDate?.getTime() === curr.startDate?.getTime();
            });
          }),
          tap((eventsArray: EventInterface[]) => {
            this.logPerf('events_listener_emit', userEmissionStart, { incomingEvents: eventsArray?.length || 0 });
            this.hasMergedEvents = eventsArray.some(event => event.isMerge);
          }),
          map((eventsArray: EventInterface[]) => {
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
          }))
        .pipe(map((events) => {
          return { events: events, user: user }
        }))
    })).subscribe((eventsAndUser) => {

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
    this.isLoading = true;
    this.shouldSearch = true;
    this.searchTerm = search.searchTerm;
    this.searchStartDate = search.startDate;
    this.searchEndDate = search.endDate;
    this.user.settings.dashboardSettings.includeMergedEvents = search.includeMergedEvents !== false;
    this.user.settings.dashboardSettings.dateRange = search.dateRange;
    this.user.settings.dashboardSettings.startDate = search.startDate && search.startDate.getTime();
    this.user.settings.dashboardSettings.endDate = search.endDate && search.endDate.getTime();
    this.user.settings.dashboardSettings.activityTypes = search.activityTypes;
    this.analyticsService.logEvent('dashboard_search', { method: DateRanges[search.dateRange] });
    await this.userService.updateUserProperties(this.user, { settings: this.user.settings })
  }

  ngOnChanges() {

  }



  ngOnDestroy(): void {
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
    }
  }

  private logPerf(step: string, start: number, meta?: Record<string, unknown>) {
    this.logger.info(`[perf] dashboard_${step}`, {
      durationMs: Number((performance.now() - start).toFixed(2)),
      ...(meta || {}),
    });
  }
}
