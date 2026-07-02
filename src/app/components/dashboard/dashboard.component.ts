import { Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppEventService } from '../../services/app.event.service';
import { combineLatest, from, merge, of, Subject } from 'rxjs';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAuthService } from '../../authentication/app.auth.service';
import {
  AppAppSettingsInterface,
  AppDashboardEventTableFiltersInterface,
  AppDashboardSettingsInterface,
  AppUserInterface,
} from '../../models/app-user.interface';
import { DateRanges } from '@sports-alliance/sports-lib';
import { Search } from '../event-search/event-search.component';
import { AppUserService } from '../../services/app.user.service';
import { DaysOfTheWeek } from '@sports-alliance/sports-lib';
import { catchError, distinctUntilChanged, filter, map, switchMap, take, tap } from 'rxjs/operators';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { LoggerService } from '../../services/logger.service';
import { AppUserUtilities } from '../../utils/app.user.utilities';

import { getDatesForDateRange } from '../../helpers/date-range-helper';
import { WhereFilterOp } from 'firebase/firestore';
import {
  buildUnitSettingsForUnitSetupPreset,
  resolveSuggestedUnitSetupPreset,
  shouldShowUnitSetupPrompt,
  UNIT_SETUP_PRESET_OPTIONS,
  UnitSetupPreset,
} from '../../helpers/unit-setup-preset.helper';
import {
  eventMatchesDashboardActivityTypes,
  normalizeDashboardEventTableFilters,
} from '../../helpers/dashboard-tile-event-filters.helper';
import {
  buildDashboardActionPromptViewModels,
  buildActivityAutoSyncEnabledSnackbarMessage,
  DASHBOARD_ACTION_PROMPT_ACTIVITY_AUTO_SYNC_SOURCE,
  DASHBOARD_ACTION_PROMPT_BACKFILL_GARMIN_SLEEP_ID,
  DASHBOARD_ACTION_PROMPT_BACKFILL_GARMIN_SLEEP_SOURCE,
  DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID,
  DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_SOURCE,
  DASHBOARD_ACTION_PROMPT_ENABLE_ACTIVITY_AUTO_SYNC_ID,
  DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID,
  DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_SOURCE,
  DASHBOARD_ACTION_PROMPT_RECONNECT_SUUNTO_SERVICE_ID,
  DASHBOARD_ACTION_PROMPT_UNIT_SETUP_ID,
  DashboardActionPromptControlChange,
  DashboardActionPromptEvent,
  DashboardActionPromptMenuEvent,
  DashboardActionPromptViewModel,
  isDashboardActionPromptDismissed,
  markDashboardActionPromptDismissed,
  resolveDashboardActivityAutoSyncRouteIds,
} from '../../helpers/dashboard-action-prompt.helper';
import { ActivitySyncRouteId } from '@shared/activity-sync-routes';
import { ActivityServiceConnectionState } from '../../services/app.user.service';
import { AppWindowService } from '../../services/app.window.service';
import {
  buildSuuntoServiceConnectionViewModel,
  SuuntoServiceConnectionViewModel,
} from '../../helpers/suunto-service-connection.helper';
import { AppSleepService } from '../../services/app.sleep.service';
import { SLEEP_PROVIDERS, SleepSyncState } from '@shared/sleep';
import { GARMIN_SLEEP_BACKFILL_REQUIRED_PERMISSIONS } from '@shared/sleep-backfill';


@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  standalone: false
})

export class DashboardComponent implements OnInit, OnDestroy {
  public user: AppUserInterface;
  public targetUser: AppUserInterface;
  public events: EventInterface[];
  public searchTerm: string;
  public searchStartDate: Date | null;
  public searchEndDate: Date | null;
  public startOfTheWeek: DaysOfTheWeek;
  public isLoading: boolean;
  public showUpload = false;
  public isInitialized = false;
  public hasMergedEvents = false;
  public readonly unitSetupOptions = UNIT_SETUP_PRESET_OPTIONS;
  public selectedUnitSetupPreset: UnitSetupPreset = resolveSuggestedUnitSetupPreset();
  public showUnitSetupPrompt = false;
  public isSavingUnitSetup = false;
  public unitSetupError: string | null = null;
  public dashboardActionPrompts: DashboardActionPromptViewModel[] = [];
  public isDismissingFirstActivityUploadPrompt = false;
  public firstActivityUploadPromptError: string | null = null;
  public isDismissingConnectActivityServicePrompt = false;
  public connectActivityServicePromptError: string | null = null;
  public isEnablingActivityAutoSyncPrompt = false;
  public activityAutoSyncPromptError: string | null = null;
  public isDismissingActivityAutoSyncPrompt = false;
  public isReconnectingSuuntoServicePrompt = false;
  public isDismissingReconnectSuuntoServicePrompt = false;
  public reconnectSuuntoServicePromptError: string | null = null;
  public isBackfillingGarminSleepPrompt = false;
  public isDismissingGarminSleepPrompt = false;
  public garminSleepBackfillPromptError: string | null = null;
  public showNoActivityDashboardState = false;
  public readonly noActivityConnectServiceOptions = [
    { serviceName: ServiceNames.GarminAPI, label: 'Garmin' },
    { serviceName: ServiceNames.SuuntoApp, label: 'Suunto' },
    { serviceName: ServiceNames.COROSAPI, label: 'COROS' },
  ];

  private shouldSearch: boolean;
  private manualSearchTrigger$ = new Subject<{ user: AppUserInterface | null; refreshToken: number }>();
  private manualSearchRefreshToken = 0;
  private initialLiveReconcilePending = false;
  private initialResolvedEventsForReconcile: EventInterface[] = [];
  private initialResolvedUserIDForReconcile: string | null = null;
  private eventTableFiltersCacheSignature: string | null = null;
  private eventTableFiltersCache: AppDashboardEventTableFiltersInterface | null = null;
  private hasActivityServiceConnection: boolean | null = null;
  private activityServiceConnectionState: ActivityServiceConnectionState | null = null;
  private uploadedActivityCount: number | null = null;
  private hasAnyActivity: boolean | null = null;
  private userIDWithKnownActivity: string | null = null;
  private suuntoConnectionView: SuuntoServiceConnectionViewModel = buildSuuntoServiceConnectionViewModel({
    hasToken: false,
    serviceMeta: null,
  });
  private garminSleepSyncState: SleepSyncState | null = null;
  private garminSleepSyncStateLoaded = false;
  private garminSleepBackfillPermissionsLoaded = false;
  private hasGarminSleepBackfillPermissions = false;
  private analyticsService = inject(AppAnalyticsService);
  private logger = inject(LoggerService);
  private destroyRef = inject(DestroyRef);
  private windowService = inject(AppWindowService);
  private sleepService = inject(AppSleepService);


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
      // Resolver may skip one-shot prefetch for all-time ranges; in that case we start empty and
      // keep loading until the first live listener emission arrives.
      const isEventsPrefetchSkipped = resolvedData.eventsPrefetchSkipped === true;
      this.events = resolvedData.events || [];
      this.user = resolvedData.user;
      // Reconcile is only needed when resolver and first live emission may duplicate the same payload.
      this.initialLiveReconcilePending = !!resolvedData.user && !isEventsPrefetchSkipped;
      this.initialResolvedEventsForReconcile = this.events || [];
      this.initialResolvedUserIDForReconcile = isEventsPrefetchSkipped ? null : (resolvedData.user?.uid || null);
      this.targetUser = resolvedData.targetUser;
      this.hasMergedEvents = resolvedData.hasMergedEvents ?? this.events?.some(event => event.isMerge) ?? false;
      this.isLoading = isEventsPrefetchSkipped;
      this.isInitialized = true;


      if (this.user) {
        this.applyEventTableFilterDates(this.getEventTableFilters(this.user), this.user);
        this.startOfTheWeek = this.user.settings.unitSettings?.startOfTheWeek;
      }
      this.syncDashboardActionPromptState();
      this.logPerf('resolved_dashboard_data', resolvedDataStart, {
        events: this.events?.length || 0,
        eventsPrefetchSkipped: isEventsPrefetchSkipped,
      });
    }

    this.shouldSearch = false;

    // @todo make this an obsrvbl
    const userID = this.route.snapshot.paramMap.get('userID');
    if (userID && !this.targetUser) { // Only fetch if not resolved
      const targetUserFetchStart = performance.now();
      try {
        this.targetUser = await this.userService.getUserByID(userID).pipe(take(1)).toPromise();
        this.syncDashboardActionPromptState();
        this.logPerf('target_user_fetch', targetUserFetchStart, { userID });
      } catch {
        void this.router.navigate(['dashboard'])
          .then(() => {
            this.snackBar.open('Page not found');
          })
          .catch((error) => {
            this.logger.error('[DashboardComponent] Failed to redirect after missing target user', error);
          });
        return;
      }
    }
    this.watchNoActivityDashboardState();
    this.watchFirstActivityUploadPromptState();
    this.watchActivityServiceConnectionPromptState();
    this.watchSuuntoReconnectPromptState();
    this.watchGarminSleepBackfillPromptState();
    merge(
      this.authService.user$.pipe(
        map((user: AppUserInterface | null) => ({ user, refreshToken: 0 }))
      ),
      this.manualSearchTrigger$
    ).pipe(
      map(({ user, refreshToken }) => ({
        user,
        refreshToken,
        eventsListenerKey: this.getEventsListenerKey(user),
      })),
      distinctUntilChanged((previous, current) => (
        previous.eventsListenerKey === current.eventsListenerKey
        && previous.refreshToken === current.refreshToken
      )),
      map(({ user }) => user),
      switchMap((user: AppUserInterface | null) => {
      if (this.shouldSearch || !this.isInitialized) {
        this.isLoading = true;
      }

      // Get the user
      if (!user) {
        void this.router.navigate(['login'])
          .catch((error) => {
            this.logger.error('[DashboardComponent] Failed to navigate to login after sign-out', error);
          });
        return of({ user: null, events: null });
      }


      if (this.user && (
        JSON.stringify(this.getEventTableFilters(this.user)) !== JSON.stringify(this.getEventTableFilters(user))
        || this.user.settings.unitSettings.startOfTheWeek !== user.settings.unitSettings.startOfTheWeek
      )) {
        this.shouldSearch = true;
      }

      // Setup the ranges to search depending on pref
      const eventTableFilters = this.getEventTableFilters(user);
      this.applyEventTableFilterDates(eventTableFilters, user);

      this.startOfTheWeek = user.settings.unitSettings.startOfTheWeek;

      const limit = 0; // @todo double check this how it relates
      const where = [];
      const includeMergedEvents = eventTableFilters.includeMergedEvents !== false;
      if (this.searchTerm) {
        where.push({
          fieldPath: 'name',
          opStr: <WhereFilterOp>'==',
          value: this.searchTerm
        });
      }

      if (eventTableFilters.dateRange !== DateRanges.all) {
        if (!this.searchStartDate || !this.searchEndDate) {
          return of({ events: [], user: user });
        }
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
              this.logger.info('[perf] dashboard_initial_live_reconcile_mismatch', {
                userID: user.uid,
                ...this.buildEventsIdentityMismatchSummary(this.initialResolvedEventsForReconcile, eventsArray),
              });
            }

            return { eventsArray, skipInitialStateUpdate: false };
          }),
          tap(({ eventsArray, skipInitialStateUpdate }) => {
            if (skipInitialStateUpdate) {
              return;
            }
            this.trackEventsListenerEmission(eventsArray);
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
            const eventTableActivityTypes = eventTableFilters.activityTypes || [];
            if (!eventTableActivityTypes.length) {
              this.logPerf('events_filtering', filterStart, {
                includeMergedEvents,
                activityTypeFilters: 0,
                resultCount: filteredEvents.length,
              });
              return filteredEvents;
            }
            const result = filteredEvents.filter(event => eventMatchesDashboardActivityTypes(event, eventTableActivityTypes));
            this.logPerf('events_filtering', filterStart, {
              includeMergedEvents,
              activityTypeFilters: eventTableActivityTypes.length,
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
      if (this.user && this.isOwnerDashboard(this.user) && this.events.length > 0) {
        this.markUserHasActivity(this.user);
        this.hasAnyActivity = true;
      }
      this.syncDashboardActionPromptState();
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
      eventTableFilters: { ...this.getEventTableFilters(this.user) },
    };

    this.isLoading = true;
    this.shouldSearch = true;
    this.searchTerm = search.searchTerm;
    this.searchStartDate = search.startDate;
    this.searchEndDate = search.endDate;

    try {
      this.user.settings.dashboardSettings.eventTableFilters = {
        ...(this.user.settings.dashboardSettings.eventTableFilters || {}),
        searchTerm: search.searchTerm || null,
        includeMergedEvents: search.includeMergedEvents !== false,
        dateRange: search.dateRange,
        startDate: search.startDate ? search.startDate.getTime() : null,
        endDate: search.endDate ? search.endDate.getTime() : null,
        activityTypes: search.activityTypes || [],
      };
      this.manualSearchRefreshToken += 1;
      this.manualSearchTrigger$.next({
        user: this.user,
        refreshToken: this.manualSearchRefreshToken,
      });
      this.analyticsService.logEvent('dashboard_search', { method: DateRanges[search.dateRange] });
      await this.persistDashboardSettings({
        eventTableFilters: this.user.settings.dashboardSettings.eventTableFilters,
      });
    } catch (error) {
      this.searchTerm = previousSearchState.searchTerm;
      this.searchStartDate = previousSearchState.searchStartDate;
      this.searchEndDate = previousSearchState.searchEndDate;
      this.user.settings.dashboardSettings.eventTableFilters = previousDashboardSettings.eventTableFilters;
      this.shouldSearch = false;
      this.isLoading = false;
      this.snackBar.open('Could not update event table filters');
      this.logger.error('[DashboardComponent] Failed to persist dashboard search filters', error);
    }
  }

  onUnitSetupPresetChange(preset: UnitSetupPreset): void {
    this.selectedUnitSetupPreset = preset;
    this.unitSetupError = null;
    this.syncDashboardActionPromptState();
  }

  onDashboardActionPromptPrimary(event: DashboardActionPromptEvent): void {
    if (event.promptId === DASHBOARD_ACTION_PROMPT_UNIT_SETUP_ID && event.action.id === 'applyUnitSetup') {
      void this.applyUnitSetupPreset();
      return;
    }

    if (event.promptId === DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID && event.action.id === 'upgradeToPro') {
      void this.openSubscriptions();
      return;
    }

    if (
      event.promptId === DASHBOARD_ACTION_PROMPT_ENABLE_ACTIVITY_AUTO_SYNC_ID
      && event.action.id === 'enableActivityAutoSync'
    ) {
      void this.enableActivityAutoSyncPrompt();
      return;
    }

    if (
      event.promptId === DASHBOARD_ACTION_PROMPT_BACKFILL_GARMIN_SLEEP_ID
      && event.action.id === 'backfillGarminSleep'
    ) {
      void this.backfillGarminSleepPrompt();
      return;
    }

    if (
      event.promptId === DASHBOARD_ACTION_PROMPT_RECONNECT_SUUNTO_SERVICE_ID
      && event.action.id === 'reconnectSuuntoService'
    ) {
      void this.reconnectSuuntoServicePrompt();
      return;
    }
  }

  onDashboardActionPromptSecondary(event: DashboardActionPromptEvent): void {
    if (event.promptId === DASHBOARD_ACTION_PROMPT_UNIT_SETUP_ID && event.action.id === 'dismissUnitSetup') {
      void this.dismissUnitSetupPrompt();
      return;
    }

    if (
      event.promptId === DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID
      && event.action.id === 'dismissFirstActivityUpload'
    ) {
      void this.dismissFirstActivityUploadPrompt();
      return;
    }

    if (
      event.promptId === DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID
      && event.action.id === 'dismissConnectActivityService'
    ) {
      void this.dismissConnectActivityServicePrompt();
      return;
    }

    if (
      event.promptId === DASHBOARD_ACTION_PROMPT_ENABLE_ACTIVITY_AUTO_SYNC_ID
      && event.action.id === 'dismissEnableActivityAutoSync'
    ) {
      void this.dismissActivityAutoSyncPrompt();
      return;
    }

    if (
      event.promptId === DASHBOARD_ACTION_PROMPT_BACKFILL_GARMIN_SLEEP_ID
      && event.action.id === 'dismissBackfillGarminSleep'
    ) {
      void this.dismissGarminSleepBackfillPrompt();
      return;
    }

    if (
      event.promptId === DASHBOARD_ACTION_PROMPT_RECONNECT_SUUNTO_SERVICE_ID
      && event.action.id === 'dismissReconnectSuuntoService'
    ) {
      void this.dismissReconnectSuuntoServicePrompt();
    }
  }

  onDashboardActionPromptMenuAction(event: DashboardActionPromptMenuEvent): void {
    if (event.promptId === DASHBOARD_ACTION_PROMPT_UNIT_SETUP_ID && event.action.id === 'openUnitSettings') {
      void this.openUnitSettings();
      return;
    }

    if (
      event.promptId === DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID
      && event.action.id === 'connectServiceProvider'
    ) {
      void this.openServiceProvider(event.action.value);
    }
  }

  onDashboardActionPromptControlChange(event: DashboardActionPromptControlChange): void {
    if (event.promptId === DASHBOARD_ACTION_PROMPT_UNIT_SETUP_ID) {
      this.onUnitSetupPresetChange(event.value as UnitSetupPreset);
      return;
    }

    if (
      event.promptId === DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID
      && event.value === 'activityUploaded'
    ) {
      this.markDashboardHasActivity();
    }
  }

  onNoActivityUploadComplete(): void {
    this.markDashboardHasActivity();
  }

  async onNoActivityConnectService(serviceName: ServiceNames): Promise<void> {
    await this.openServiceProvider(serviceName);
  }

  async applyUnitSetupPreset(): Promise<void> {
    if (!this.user) {
      return;
    }

    this.isSavingUnitSetup = true;
    this.unitSetupError = null;

    try {
      const nextUnitSettings = buildUnitSettingsForUnitSetupPreset(this.selectedUnitSetupPreset);
      const unitSetupCompletedAppSettings = {
        unitSetupCompleted: true,
      };
      const nextAppSettings = {
        ...(this.user.settings?.appSettings || {}),
        ...unitSetupCompletedAppSettings,
      };

      await this.userService.updateUserProperties(this.user, {
        settings: {
          unitSettings: nextUnitSettings,
          appSettings: unitSetupCompletedAppSettings,
        },
      });
      this.user.settings = {
        ...(this.user.settings || {} as any),
        unitSettings: nextUnitSettings,
        appSettings: nextAppSettings as any,
      };
      this.syncDashboardActionPromptState();
      this.snackBar.open('Unit preferences saved', undefined, { duration: 2000 });
      this.analyticsService.logEvent('unit_setup_complete', { preset: this.selectedUnitSetupPreset });
    } catch (error) {
      this.unitSetupError = 'Could not save unit preferences.';
      this.logger.error('[DashboardComponent] Failed to apply unit setup preset', error);
    } finally {
      this.isSavingUnitSetup = false;
      this.syncDashboardActionPromptState();
    }
  }

  async dismissUnitSetupPrompt(): Promise<void> {
    if (!this.user) {
      return;
    }

    this.isSavingUnitSetup = true;
    this.unitSetupError = null;

    try {
      const unitSetupCompletedAppSettings = {
        unitSetupCompleted: true,
      };
      const nextAppSettings = {
        ...(this.user.settings?.appSettings || {}),
        ...unitSetupCompletedAppSettings,
      };

      await this.userService.updateUserProperties(this.user, {
        settings: {
          appSettings: unitSetupCompletedAppSettings,
        },
      });
      this.user.settings = this.user.settings || {} as any;
      this.user.settings.appSettings = nextAppSettings as any;
      this.syncDashboardActionPromptState();
      this.snackBar.open('You can change units in Settings anytime', undefined, { duration: 2500 });
      this.analyticsService.logEvent('unit_setup_skip');
    } catch (error) {
      this.unitSetupError = 'Could not save this choice.';
      this.logger.error('[DashboardComponent] Failed to dismiss unit setup prompt', error);
    } finally {
      this.isSavingUnitSetup = false;
      this.syncDashboardActionPromptState();
    }
  }

  async dismissFirstActivityUploadPrompt(): Promise<void> {
    if (!this.user) {
      return;
    }

    this.isDismissingFirstActivityUploadPrompt = true;
    this.firstActivityUploadPromptError = null;
    this.syncDashboardActionPromptState();

    try {
      this.user.settings = this.user.settings || {} as any;
      const nextAppSettings = {
        ...(this.user.settings.appSettings || {}),
      } as AppAppSettingsInterface;
      const dismissedState = markDashboardActionPromptDismissed(
        nextAppSettings,
        DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID,
        DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_SOURCE,
        Date.now(),
      );

      await this.userService.updateUserProperties(this.user, {
        settings: {
          appSettings: {
            dashboardActionPrompts: {
              [DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID]: dismissedState,
            },
          },
        },
      });
      this.user.settings.appSettings = nextAppSettings;
      this.analyticsService.logEvent('dashboard_action_prompt_dismiss', {
        prompt_id: DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID,
      });
    } catch (error) {
      this.firstActivityUploadPromptError = 'Could not save this choice.';
      this.logger.error('[DashboardComponent] Failed to dismiss first activity prompt', error);
    } finally {
      this.isDismissingFirstActivityUploadPrompt = false;
      this.syncDashboardActionPromptState();
    }
  }

  async dismissConnectActivityServicePrompt(): Promise<void> {
    if (!this.user) {
      return;
    }

    this.isDismissingConnectActivityServicePrompt = true;
    this.connectActivityServicePromptError = null;
    this.syncDashboardActionPromptState();

    try {
      this.user.settings = this.user.settings || {} as any;
      const nextAppSettings = {
        ...(this.user.settings.appSettings || {}),
      } as AppAppSettingsInterface;
      const dismissedState = markDashboardActionPromptDismissed(
        nextAppSettings,
        DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID,
        DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_SOURCE,
        Date.now(),
      );

      await this.userService.updateUserProperties(this.user, {
        settings: {
          appSettings: {
            dashboardActionPrompts: {
              [DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID]: dismissedState,
            },
          },
        },
      });
      this.user.settings.appSettings = nextAppSettings;
      this.analyticsService.logEvent('dashboard_action_prompt_dismiss', {
        prompt_id: DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID,
      });
    } catch (error) {
      this.connectActivityServicePromptError = 'Could not save this choice.';
      this.logger.error('[DashboardComponent] Failed to dismiss service connection prompt', error);
    } finally {
      this.isDismissingConnectActivityServicePrompt = false;
      this.syncDashboardActionPromptState();
    }
  }

  async enableActivityAutoSyncPrompt(): Promise<void> {
    if (!this.user || this.isEnablingActivityAutoSyncPrompt) {
      return;
    }

    const routeIds = this.getEligibleActivityAutoSyncRouteIds();
    if (!routeIds.length) {
      this.syncDashboardActionPromptState();
      return;
    }

    this.isEnablingActivityAutoSyncPrompt = true;
    this.activityAutoSyncPromptError = null;
    this.syncDashboardActionPromptState();

    try {
      const routeUpdates = routeIds.reduce<Partial<Record<ActivitySyncRouteId, boolean>>>((updates, routeID) => {
        updates[routeID] = true;
        return updates;
      }, {});

      await this.userService.updateActivitySyncRouteSettings(this.user, routeUpdates);
      routeIds.forEach(routeID => this.analyticsService.logActivitySyncRouteToggle(routeID, true));
      this.snackBar.open(buildActivityAutoSyncEnabledSnackbarMessage(routeIds), undefined, { duration: 3000 });
    } catch (error) {
      this.activityAutoSyncPromptError = 'Could not enable auto-sync.';
      this.logger.error('[DashboardComponent] Failed to enable activity auto-sync prompt routes', error);
    } finally {
      this.isEnablingActivityAutoSyncPrompt = false;
      this.syncDashboardActionPromptState();
    }
  }

  async dismissActivityAutoSyncPrompt(): Promise<void> {
    if (!this.user) {
      return;
    }

    this.isDismissingActivityAutoSyncPrompt = true;
    this.activityAutoSyncPromptError = null;
    this.syncDashboardActionPromptState();

    try {
      this.user.settings = this.user.settings || {} as any;
      const nextAppSettings = {
        ...(this.user.settings.appSettings || {}),
      } as AppAppSettingsInterface;
      const dismissedState = markDashboardActionPromptDismissed(
        nextAppSettings,
        DASHBOARD_ACTION_PROMPT_ENABLE_ACTIVITY_AUTO_SYNC_ID,
        DASHBOARD_ACTION_PROMPT_ACTIVITY_AUTO_SYNC_SOURCE,
        Date.now(),
      );

      await this.userService.updateUserProperties(this.user, {
        settings: {
          appSettings: {
            dashboardActionPrompts: {
              [DASHBOARD_ACTION_PROMPT_ENABLE_ACTIVITY_AUTO_SYNC_ID]: dismissedState,
            },
          },
        },
      });
      this.user.settings.appSettings = nextAppSettings;
      this.analyticsService.logEvent('dashboard_action_prompt_dismiss', {
        prompt_id: DASHBOARD_ACTION_PROMPT_ENABLE_ACTIVITY_AUTO_SYNC_ID,
      });
    } catch (error) {
      this.activityAutoSyncPromptError = 'Could not save this choice.';
      this.logger.error('[DashboardComponent] Failed to dismiss activity auto-sync prompt', error);
    } finally {
      this.isDismissingActivityAutoSyncPrompt = false;
      this.syncDashboardActionPromptState();
    }
  }

  async backfillGarminSleepPrompt(): Promise<void> {
    if (!this.user || this.isBackfillingGarminSleepPrompt) {
      return;
    }

    this.isBackfillingGarminSleepPrompt = true;
    this.garminSleepBackfillPromptError = null;
    this.syncDashboardActionPromptState();

    try {
      this.analyticsService.logEvent('backfilled_sleep_history', {
        method: ServiceNames.GarminAPI,
        source: 'dashboard_prompt',
      });
    } catch (error) {
      this.logger.error(error);
    }

    try {
      const result = await this.userService.backfillGarminSleepForCurrentUser();
      const lastBackfillQueuedAtMs = Date.now();
      this.garminSleepSyncState = {
        ...(this.garminSleepSyncState || {
          provider: SLEEP_PROVIDERS.GarminAPI,
          status: 'ready',
          updatedAtMs: lastBackfillQueuedAtMs,
        }),
        lastBackfillQueuedAtMs,
        lastBackfillStartMs: new Date(result.startDate).getTime(),
        lastBackfillEndMs: new Date(result.endDate).getTime(),
        lastBackfillQueueItems: result.queued,
        nextBackfillAllowedAtMs: result.nextAllowedAtMs,
        lastError: null,
        updatedAtMs: lastBackfillQueuedAtMs,
      };
      this.garminSleepSyncStateLoaded = true;
      this.snackBar.open(`Garmin sleep backfill requested: ${result.queued} windows.`, undefined, { duration: 3000 });
    } catch (error) {
      this.garminSleepBackfillPromptError = 'Could not request Garmin sleep history.';
      this.logger.error('[DashboardComponent] Failed to request Garmin sleep backfill from dashboard prompt', error);
    } finally {
      this.isBackfillingGarminSleepPrompt = false;
      this.syncDashboardActionPromptState();
    }
  }

  async dismissGarminSleepBackfillPrompt(): Promise<void> {
    if (!this.user) {
      return;
    }

    this.isDismissingGarminSleepPrompt = true;
    this.garminSleepBackfillPromptError = null;
    this.syncDashboardActionPromptState();

    try {
      this.user.settings = this.user.settings || {} as any;
      const nextAppSettings = {
        ...(this.user.settings.appSettings || {}),
      } as AppAppSettingsInterface;
      const dismissedState = markDashboardActionPromptDismissed(
        nextAppSettings,
        DASHBOARD_ACTION_PROMPT_BACKFILL_GARMIN_SLEEP_ID,
        DASHBOARD_ACTION_PROMPT_BACKFILL_GARMIN_SLEEP_SOURCE,
        Date.now(),
      );

      await this.userService.updateUserProperties(this.user, {
        settings: {
          appSettings: {
            dashboardActionPrompts: {
              [DASHBOARD_ACTION_PROMPT_BACKFILL_GARMIN_SLEEP_ID]: dismissedState,
            },
          },
        },
      });
      this.user.settings.appSettings = nextAppSettings;
      this.analyticsService.logEvent('dashboard_action_prompt_dismiss', {
        prompt_id: DASHBOARD_ACTION_PROMPT_BACKFILL_GARMIN_SLEEP_ID,
      });
    } catch (error) {
      this.garminSleepBackfillPromptError = 'Could not save this choice.';
      this.logger.error('[DashboardComponent] Failed to dismiss Garmin sleep backfill prompt', error);
    } finally {
      this.isDismissingGarminSleepPrompt = false;
      this.syncDashboardActionPromptState();
    }
  }

  async reconnectSuuntoServicePrompt(): Promise<void> {
    if (!this.user || this.isReconnectingSuuntoServicePrompt) {
      return;
    }

    this.isReconnectingSuuntoServicePrompt = true;
    this.reconnectSuuntoServicePromptError = null;
    this.syncDashboardActionPromptState();

    try {
      const tokenAndURI = await this.userService.getCurrentUserServiceTokenAndRedirectURI(ServiceNames.SuuntoApp);
      this.analyticsService.logEvent('dashboard_action_prompt_reconnect_service', {
        prompt_id: DASHBOARD_ACTION_PROMPT_RECONNECT_SUUNTO_SERVICE_ID,
        service_name: ServiceNames.SuuntoApp,
      });
      this.windowService.windowRef.location.href = tokenAndURI.redirect_uri;
    } catch (error: any) {
      this.reconnectSuuntoServicePromptError = 'Could not start Suunto reconnect.';
      this.logger.error('[DashboardComponent] Failed to start Suunto reconnect prompt flow', error);
      this.isReconnectingSuuntoServicePrompt = false;
      this.syncDashboardActionPromptState();
    }
  }

  async dismissReconnectSuuntoServicePrompt(): Promise<void> {
    if (!this.user) {
      return;
    }

    this.isDismissingReconnectSuuntoServicePrompt = true;
    this.reconnectSuuntoServicePromptError = null;
    this.syncDashboardActionPromptState();

    try {
      this.user.settings = this.user.settings || {} as any;
      const nextAppSettings = {
        ...(this.user.settings.appSettings || {}),
      } as AppAppSettingsInterface;
      const dismissedState = markDashboardActionPromptDismissed(
        nextAppSettings,
        DASHBOARD_ACTION_PROMPT_RECONNECT_SUUNTO_SERVICE_ID,
        this.getReconnectSuuntoServicePromptSource(),
        Date.now(),
      );

      await this.userService.updateUserProperties(this.user, {
        settings: {
          appSettings: {
            dashboardActionPrompts: {
              [DASHBOARD_ACTION_PROMPT_RECONNECT_SUUNTO_SERVICE_ID]: dismissedState,
            },
          },
        },
      });
      this.user.settings.appSettings = nextAppSettings;
      this.analyticsService.logEvent('dashboard_action_prompt_dismiss', {
        prompt_id: DASHBOARD_ACTION_PROMPT_RECONNECT_SUUNTO_SERVICE_ID,
      });
    } catch (error) {
      this.reconnectSuuntoServicePromptError = 'Could not save this choice.';
      this.logger.error('[DashboardComponent] Failed to dismiss Suunto reconnect prompt', error);
    } finally {
      this.isDismissingReconnectSuuntoServicePrompt = false;
      this.syncDashboardActionPromptState();
    }
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

  private trackEventsListenerEmission(eventsArray: EventInterface[]): void {
    const emitStart = performance.now();
    this.hasMergedEvents = eventsArray.some(event => event.isMerge);
    this.logPerf('events_listener_emit', emitStart, { incomingEvents: eventsArray?.length || 0 });
  }

  private syncDashboardActionPromptState(): void {
    this.showUnitSetupPrompt = shouldShowUnitSetupPrompt(this.user, this.targetUser);
    this.updateNoActivityDashboardState();
    const suppressNoActivityPrompts = this.showNoActivityDashboardState;
    this.dashboardActionPrompts = buildDashboardActionPromptViewModels({
      showUnitSetupPrompt: this.showUnitSetupPrompt,
      unitSetupBusy: this.isSavingUnitSetup,
      unitSetupError: this.unitSetupError,
      showFirstActivityUploadPrompt: !suppressNoActivityPrompts && this.shouldShowFirstActivityUploadPrompt(),
      firstActivityUploadBusy: this.isDismissingFirstActivityUploadPrompt,
      firstActivityUploadError: this.firstActivityUploadPromptError,
      showConnectActivityServicePrompt: !suppressNoActivityPrompts && this.shouldShowConnectActivityServicePrompt(),
      connectActivityServiceBusy: this.isDismissingConnectActivityServicePrompt,
      connectActivityServiceError: this.connectActivityServicePromptError,
      showEnableActivityAutoSyncPrompt: this.shouldShowActivityAutoSyncPrompt(),
      enableActivityAutoSyncBusy: this.isEnablingActivityAutoSyncPrompt || this.isDismissingActivityAutoSyncPrompt,
      enableActivityAutoSyncError: this.activityAutoSyncPromptError,
      enableActivityAutoSyncRouteIds: this.getEligibleActivityAutoSyncRouteIds(),
      showBackfillGarminSleepPrompt: this.shouldShowGarminSleepBackfillPrompt(),
      backfillGarminSleepBusy: this.isBackfillingGarminSleepPrompt || this.isDismissingGarminSleepPrompt,
      backfillGarminSleepError: this.garminSleepBackfillPromptError,
      showReconnectSuuntoServicePrompt: this.shouldShowReconnectSuuntoServicePrompt(),
      reconnectSuuntoServiceBusy: this.isReconnectingSuuntoServicePrompt || this.isDismissingReconnectSuuntoServicePrompt,
      reconnectSuuntoServiceError: this.reconnectSuuntoServicePromptError,
    });
  }

  private watchNoActivityDashboardState(): void {
    this.authService.user$.pipe(
      switchMap((user: AppUserInterface | null) => {
        const hasKnownActivity = !!user && this.userIDWithKnownActivity === user.uid;
        this.hasAnyActivity = hasKnownActivity ? true : null;
        this.syncDashboardActionPromptState();

        if (!user || !this.isOwnerDashboard(user)) {
          return of(null);
        }

        if (hasKnownActivity) {
          return of(true);
        }

        return from(this.eventService.hasAnyActivity(user)).pipe(
          catchError(error => {
            this.logger.warn('[DashboardComponent] Failed to check dashboard activity existence', {
              userID: user.uid,
            }, error);
            return of(null);
          }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((hasAnyActivity) => {
      if (this.hasAnyActivity === true && hasAnyActivity !== true) {
        this.syncDashboardActionPromptState();
        return;
      }
      if (hasAnyActivity === true) {
        this.markUserHasActivity(this.user);
      }
      this.hasAnyActivity = hasAnyActivity;
      this.syncDashboardActionPromptState();
    });
  }

  private watchFirstActivityUploadPromptState(): void {
    this.authService.user$.pipe(
      switchMap((user: AppUserInterface | null) => {
        this.uploadedActivityCount = null;
        this.syncDashboardActionPromptState();

        if (!this.shouldEvaluateFirstActivityUploadPrompt(user)) {
          return of(null);
        }

        return from(this.eventService.getEventCount(user)).pipe(
          catchError(error => {
            this.logger.warn('[DashboardComponent] Failed to read activity count for dashboard prompt', {
              userID: user.uid,
            }, error);
            return of(null);
          }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((activityCount) => {
      this.uploadedActivityCount = activityCount;
      this.syncDashboardActionPromptState();
    });
  }

  private watchActivityServiceConnectionPromptState(): void {
    this.authService.user$.pipe(
      switchMap((user: AppUserInterface | null) => {
        this.hasActivityServiceConnection = null;
        this.activityServiceConnectionState = null;
        this.syncDashboardActionPromptState();

        if (!this.shouldEvaluateActivityServicePrompts(user)) {
          return of(null);
        }

        return this.userService.watchActivityServiceConnectionState(user);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((connectionState) => {
      this.activityServiceConnectionState = connectionState;
      this.hasActivityServiceConnection = connectionState
        ? Object.values(connectionState).some(isConnected => isConnected === true)
        : null;
      this.syncDashboardActionPromptState();
    });
  }

  private watchSuuntoReconnectPromptState(): void {
    this.authService.user$.pipe(
      switchMap((user: AppUserInterface | null) => {
        this.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({
          hasToken: false,
          serviceMeta: null,
        });
        this.syncDashboardActionPromptState();

        if (!this.shouldEvaluateReconnectSuuntoServicePrompt(user)) {
          return of(this.suuntoConnectionView);
        }

        return this.userService.watchSuuntoServiceConnectionView(user).pipe(
          catchError(error => {
            this.logger.warn('[DashboardComponent] Failed to read Suunto connection view for reconnect prompt', {
              userID: user.uid,
            }, error);
            return of(buildSuuntoServiceConnectionViewModel({
              hasToken: false,
              serviceMeta: null,
            }));
          }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((connectionView) => {
      this.suuntoConnectionView = connectionView;
      this.syncDashboardActionPromptState();
    });
  }

  private watchGarminSleepBackfillPromptState(): void {
    this.authService.user$.pipe(
      switchMap((user: AppUserInterface | null) => {
        this.garminSleepSyncState = null;
        this.garminSleepSyncStateLoaded = false;
        this.garminSleepBackfillPermissionsLoaded = false;
        this.hasGarminSleepBackfillPermissions = false;
        this.syncDashboardActionPromptState();

        if (!this.shouldEvaluateGarminSleepBackfillPrompt(user)) {
          return of({
            stateLoaded: false,
            state: null as SleepSyncState | null,
            permissionsLoaded: false,
            hasPermissions: false,
          });
        }

        return combineLatest([
          this.sleepService.watchSyncState(user.uid, SLEEP_PROVIDERS.GarminAPI).pipe(
            catchError(error => {
              this.logger.warn('[DashboardComponent] Failed to read Garmin sleep sync state for dashboard prompt', {
                userID: user.uid,
              }, error);
              return of(null as SleepSyncState | null);
            }),
          ),
          this.userService.getServiceToken(user, ServiceNames.GarminAPI).pipe(
            map(tokens => this.hasRequiredGarminSleepBackfillPermissions(tokens)),
            catchError(error => {
              this.logger.warn('[DashboardComponent] Failed to read Garmin permissions for sleep backfill prompt', {
                userID: user.uid,
              }, error);
              return of(false);
            }),
          ),
        ]).pipe(
          map(([state, hasPermissions]) => ({
            stateLoaded: true,
            state,
            permissionsLoaded: true,
            hasPermissions,
          })),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ stateLoaded, state, permissionsLoaded, hasPermissions }) => {
      this.garminSleepSyncStateLoaded = stateLoaded;
      this.garminSleepSyncState = state;
      this.garminSleepBackfillPermissionsLoaded = permissionsLoaded;
      this.hasGarminSleepBackfillPermissions = hasPermissions;
      this.syncDashboardActionPromptState();
    });
  }

  private shouldEvaluateFirstActivityUploadPrompt(user: AppUserInterface | null | undefined): user is AppUserInterface {
    if (!user || !this.isOwnerDashboard(user)) {
      return false;
    }

    if (AppUserUtilities.hasProAccess(user, false)) {
      return false;
    }

    return !isDashboardActionPromptDismissed(
      user.settings?.appSettings,
      DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID,
    );
  }

  private shouldShowFirstActivityUploadPrompt(): boolean {
    if (!this.user || this.uploadedActivityCount !== 0) {
      return false;
    }

    return this.shouldEvaluateFirstActivityUploadPrompt(this.user);
  }

  private shouldEvaluateActivityServiceConnectionPrompt(user: AppUserInterface | null | undefined): user is AppUserInterface {
    if (!user || !this.isOwnerDashboard(user)) {
      return false;
    }

    if (!AppUserUtilities.hasProAccess(user, user.admin === true)) {
      return false;
    }

    return !isDashboardActionPromptDismissed(
      user.settings?.appSettings,
      DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID,
    );
  }

  private shouldShowConnectActivityServicePrompt(): boolean {
    if (!this.user || this.hasActivityServiceConnection !== false) {
      return false;
    }

    return this.shouldEvaluateActivityServiceConnectionPrompt(this.user);
  }

  private shouldEvaluateActivityAutoSyncPrompt(user: AppUserInterface | null | undefined): user is AppUserInterface {
    if (!user || !this.isOwnerDashboard(user)) {
      return false;
    }

    if (!AppUserUtilities.hasProAccess(user, user.admin === true)) {
      return false;
    }

    return !isDashboardActionPromptDismissed(
      user.settings?.appSettings,
      DASHBOARD_ACTION_PROMPT_ENABLE_ACTIVITY_AUTO_SYNC_ID,
    );
  }

  private shouldShowActivityAutoSyncPrompt(): boolean {
    if (!this.user || !this.activityServiceConnectionState) {
      return false;
    }

    return this.shouldEvaluateActivityAutoSyncPrompt(this.user)
      && this.getEligibleActivityAutoSyncRouteIds().length > 0;
  }

  private shouldEvaluateGarminSleepBackfillPrompt(user: AppUserInterface | null | undefined): user is AppUserInterface {
    if (!user || !this.isOwnerDashboard(user)) {
      return false;
    }

    if (!AppUserUtilities.hasProAccess(user, user.admin === true)) {
      return false;
    }

    return !isDashboardActionPromptDismissed(
      user.settings?.appSettings,
      DASHBOARD_ACTION_PROMPT_BACKFILL_GARMIN_SLEEP_ID,
      DASHBOARD_ACTION_PROMPT_BACKFILL_GARMIN_SLEEP_SOURCE,
    );
  }

  private shouldShowGarminSleepBackfillPrompt(): boolean {
    if (!this.user || !this.activityServiceConnectionState?.[ServiceNames.GarminAPI]) {
      return false;
    }

    if (
      !this.shouldEvaluateGarminSleepBackfillPrompt(this.user)
      || !this.garminSleepSyncStateLoaded
      || !this.garminSleepBackfillPermissionsLoaded
      || !this.hasGarminSleepBackfillPermissions
    ) {
      return false;
    }

    const lastBackfillQueuedAtMs = Number(this.garminSleepSyncState?.lastBackfillQueuedAtMs);
    if (Number.isFinite(lastBackfillQueuedAtMs) && lastBackfillQueuedAtMs > 0) {
      return false;
    }

    const nextBackfillAllowedAtMs = Number(this.garminSleepSyncState?.nextBackfillAllowedAtMs);
    return !Number.isFinite(nextBackfillAllowedAtMs) || nextBackfillAllowedAtMs <= Date.now();
  }

  private hasRequiredGarminSleepBackfillPermissions(tokens: unknown): boolean {
    if (!Array.isArray(tokens)) {
      return false;
    }

    return tokens.some((token) => {
      const permissions = (token as { permissions?: unknown })?.permissions;
      if (!Array.isArray(permissions)) {
        return false;
      }
      const permissionSet = new Set(permissions.map(permission => `${permission}`));
      return GARMIN_SLEEP_BACKFILL_REQUIRED_PERMISSIONS.every(permission => permissionSet.has(permission));
    });
  }

  private shouldEvaluateReconnectSuuntoServicePrompt(user: AppUserInterface | null | undefined): user is AppUserInterface {
    if (!user || !this.isOwnerDashboard(user)) {
      return false;
    }

    if (!AppUserUtilities.hasProAccess(user, user.admin === true)) {
      return false;
    }

    return !isDashboardActionPromptDismissed(
      user.settings?.appSettings,
      DASHBOARD_ACTION_PROMPT_RECONNECT_SUUNTO_SERVICE_ID,
      this.getReconnectSuuntoServicePromptSource(),
    );
  }

  private shouldShowReconnectSuuntoServicePrompt(): boolean {
    if (!this.user) {
      return false;
    }

    return this.shouldEvaluateReconnectSuuntoServicePrompt(this.user)
      && this.suuntoConnectionView.reconnectRequired;
  }

  private getReconnectSuuntoServicePromptSource(): string {
    return this.suuntoConnectionView.reconnectPromptSource;
  }

  private shouldEvaluateActivityServicePrompts(user: AppUserInterface | null | undefined): user is AppUserInterface {
    return this.shouldEvaluateActivityServiceConnectionPrompt(user)
      || this.shouldEvaluateActivityAutoSyncPrompt(user)
      || this.shouldEvaluateGarminSleepBackfillPrompt(user);
  }

  private updateNoActivityDashboardState(): void {
    this.showNoActivityDashboardState = this.isInitialized
      && this.hasAnyActivity === false
      && !!this.user
      && this.isOwnerDashboard(this.user);
  }

  private markDashboardHasActivity(): void {
    this.markUserHasActivity(this.user);
    this.hasAnyActivity = true;
    this.uploadedActivityCount = 1;
    this.showNoActivityDashboardState = false;
    this.syncDashboardActionPromptState();
  }

  private markUserHasActivity(user: AppUserInterface | null | undefined): void {
    if (user?.uid) {
      this.userIDWithKnownActivity = user.uid;
    }
  }

  private getEligibleActivityAutoSyncRouteIds(): ActivitySyncRouteId[] {
    return resolveDashboardActivityAutoSyncRouteIds({
      userID: this.user?.uid,
      connectionState: this.activityServiceConnectionState,
      reconnectRequiredServices: {
        [ServiceNames.SuuntoApp]: this.suuntoConnectionView.reconnectRequired,
      },
      routeSettings: this.user?.settings?.serviceSyncSettings?.activitySyncRoutes,
    });
  }

  private isOwnerDashboard(user: AppUserInterface): boolean {
    return !this.targetUser || this.targetUser.uid === user.uid;
  }

  private async openUnitSettings(): Promise<void> {
    await this.router.navigate(['/settings'], {
      queryParams: { section: 'units' },
    });
  }

  private async openServiceProvider(serviceName: ServiceNames | string | undefined): Promise<void> {
    if (!serviceName) {
      return;
    }

    await this.router.navigate(['/services'], {
      queryParams: { serviceName },
    });
  }

  private async openSubscriptions(): Promise<void> {
    await this.router.navigate(['/subscriptions']);
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

  private buildEventsIdentityMismatchSummary(
    previousEvents: EventInterface[] = [],
    currentEvents: EventInterface[] = [],
  ): Record<string, unknown> {
    const previousLength = previousEvents?.length || 0;
    const currentLength = currentEvents?.length || 0;
    if (previousLength !== currentLength) {
      return {
        mismatchKind: 'length',
        previousLength,
        currentLength,
      };
    }

    let mismatchedIdCount = 0;
    let mismatchedNameCount = 0;
    let mismatchedStartDateCount = 0;
    let firstMismatchIndex = -1;
    let firstPreviousID: string | null = null;
    let firstCurrentID: string | null = null;

    for (let index = 0; index < previousEvents.length; index += 1) {
      const previousEvent = previousEvents[index];
      const currentEvent = currentEvents[index];
      const previousID = this.getEventStableID(previousEvent);
      const currentID = this.getEventStableID(currentEvent);
      const hasIdMismatch = previousID !== currentID;
      const hasNameMismatch = previousEvent?.name !== currentEvent?.name;
      const hasStartDateMismatch = this.getEventStableStartDate(previousEvent) !== this.getEventStableStartDate(currentEvent);

      if (hasIdMismatch) {
        mismatchedIdCount += 1;
      }
      if (hasNameMismatch) {
        mismatchedNameCount += 1;
      }
      if (hasStartDateMismatch) {
        mismatchedStartDateCount += 1;
      }

      if (firstMismatchIndex < 0 && (hasIdMismatch || hasNameMismatch || hasStartDateMismatch)) {
        firstMismatchIndex = index;
        firstPreviousID = previousID;
        firstCurrentID = currentID;
      }
    }

    return {
      mismatchKind: (mismatchedIdCount || mismatchedNameCount || mismatchedStartDateCount) ? 'identity_fields' : 'none',
      previousLength,
      currentLength,
      mismatchedIdCount,
      mismatchedNameCount,
      mismatchedStartDateCount,
      firstMismatchIndex,
      firstPreviousID,
      firstCurrentID,
    };
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

    const eventTableFilters = this.getEventTableFilters(user);
    const activityTypes = Array.isArray(eventTableFilters?.activityTypes)
      ? [...eventTableFilters.activityTypes].sort((left, right) => `${left}`.localeCompare(`${right}`))
      : [];

    return JSON.stringify({
      queryUserID: this.targetUser?.uid || user.uid,
      dateRange: eventTableFilters?.dateRange ?? null,
      startDate: eventTableFilters?.startDate ?? null,
      endDate: eventTableFilters?.endDate ?? null,
      includeMergedEvents: eventTableFilters?.includeMergedEvents !== false,
      activityTypes,
      startOfTheWeek: user.settings?.unitSettings?.startOfTheWeek ?? null,
      searchTerm: eventTableFilters?.searchTerm || null,
    });
  }

  public get eventTableFilters(): AppDashboardEventTableFiltersInterface {
    return this.getEventTableFilters(this.user);
  }

  private persistDashboardSettings(dashboardSettings: Partial<AppDashboardSettingsInterface>): Promise<void> {
    return this.userService.updateUserProperties(this.user, {
      settings: { dashboardSettings },
    });
  }

  private getEventTableFilters(user: AppUserInterface | null | undefined): AppDashboardEventTableFiltersInterface {
    const dashboardSettings = user?.settings?.dashboardSettings;
    const normalizedFilters = normalizeDashboardEventTableFilters(dashboardSettings?.eventTableFilters, {
      dateRange: dashboardSettings?.dateRange,
      startDate: dashboardSettings?.startDate,
      endDate: dashboardSettings?.endDate,
      activityTypes: dashboardSettings?.activityTypes,
      includeMergedEvents: dashboardSettings?.includeMergedEvents,
    });
    const cacheSignature = this.getEventTableFiltersSignature(normalizedFilters);
    if (this.eventTableFiltersCache && this.eventTableFiltersCacheSignature === cacheSignature) {
      return this.eventTableFiltersCache;
    }

    this.eventTableFiltersCacheSignature = cacheSignature;
    this.eventTableFiltersCache = normalizedFilters;
    return normalizedFilters;
  }

  private getEventTableFiltersSignature(filters: AppDashboardEventTableFiltersInterface): string {
    return JSON.stringify({
      searchTerm: filters.searchTerm || null,
      dateRange: filters.dateRange,
      startDate: filters.startDate,
      endDate: filters.endDate,
      includeMergedEvents: filters.includeMergedEvents !== false,
      activityTypes: filters.activityTypes || [],
    });
  }

  private applyEventTableFilterDates(filters: AppDashboardEventTableFiltersInterface, user: AppUserInterface): void {
    this.searchTerm = filters.searchTerm || '';
    if (filters.dateRange === DateRanges.custom && filters.startDate !== null && filters.endDate !== null) {
      this.searchStartDate = new Date(filters.startDate);
      this.searchEndDate = new Date(filters.endDate);
      return;
    }

    const startOfTheWeek = user.settings.unitSettings?.startOfTheWeek ?? DaysOfTheWeek.Monday;
    const range = getDatesForDateRange(filters.dateRange, startOfTheWeek);
    this.searchStartDate = range.startDate ?? null;
    this.searchEndDate = range.endDate ?? null;
  }
}
