import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { debounceTime } from 'rxjs/operators';
import { firstValueFrom, Subscription } from 'rxjs';

import { ActivityInterface } from '@sports-alliance/sports-lib';
import { AppEventInterface } from '../../../../functions/src/shared/app-event.interface';
import { EventInterface } from '@sports-alliance/sports-lib';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAuthService } from '../../authentication/app.auth.service';
import { User } from '@sports-alliance/sports-lib';
import {
  ChartCursorBehaviours,
  ChartThemes,
  XAxisTypes
} from '@sports-alliance/sports-lib';
import {
  DataDistance,
  DataGradeAdjustedSpeed,
  DataLatitudeDegrees,
  DataLongitudeDegrees,
  DataSpeed,
  DynamicDataLoader
} from '@sports-alliance/sports-lib';
import { AppThemeService } from '../../services/app.theme.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../services/app.user.service';
import { AppActivitySelectionService } from '../../services/activity-selection-service/app-activity-selection.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { LapTypes } from '@sports-alliance/sports-lib';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { LoggerService } from '../../services/logger.service';
import { AppEventService } from '../../services/app.event.service';
import { shouldRenderIntensityZonesChart } from '../../helpers/intensity-zones-chart-data-helper';
import { shouldRenderPowerCurveChart } from '../../helpers/power-curve-chart-data-helper';
import { reconcileEventDetailsLiveUpdate } from '../../utils/event-live-reconcile';
@Component({
  selector: 'app-event-card',
  templateUrl: './event.card.component.html',
  styleUrls: ['./event.card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class EventCardComponent implements OnInit {
  // Inject services
  private destroyRef = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  public router = inject(Router);
  private authService = inject(AppAuthService);
  private userService = inject(AppUserService);
  private activitySelectionService = inject(AppActivitySelectionService);
  private userSettingsQuery = inject(AppUserSettingsQueryService);
  private snackBar = inject(MatSnackBar);
  private themeService = inject(AppThemeService);
  private bottomSheet = inject(MatBottomSheet);
  private logger = inject(LoggerService);
  private eventService = inject(AppEventService);

  // Signal-based state
  public event = signal<AppEventInterface | null>(null);
  public currentUser = signal<User | null>(null);
  public selectedActivitiesInstant = signal<ActivityInterface[]>([]);
  public selectedActivitiesDebounced = signal<ActivityInterface[]>([]);
  public isDownloading = signal<boolean>(false);
  public targetUserID = signal<string>('');
  private liveSyncSubscription: Subscription | null = null;
  private liveSyncRouteKey: string | null = null;
  private liveReloadInProgress = false;

  // Computed signals for template - replaces method calls
  public hasLapsFlag = computed(() =>
    this.event()?.getActivities().some(a => a.getLaps().length > 0) ?? false
  );

  public hasIntensityZonesFlag = computed(() =>
    shouldRenderIntensityZonesChart(this.selectedActivitiesInstant())
  );

  public hasPowerCurveFlag = computed(() =>
    shouldRenderPowerCurveChart(this.selectedActivitiesInstant())
  );

  public hasPerformanceChartsFlag = computed(() =>
    this.hasIntensityZonesFlag() || this.hasPowerCurveFlag()
  );

  public hasDevicesFlag = computed(() =>
    this.event()?.getActivities().some(a =>
      a.creator?.devices?.some(d => d.name || d.manufacturer)
    ) ?? false
  );

  public hasPositionsFlag = computed(() =>
    this.event()?.getActivities().some(a => a.hasPositionData()) ?? false
  );

  // Computed ownership check
  public isOwner = computed(() => {
    const targetUID = this.targetUserID();
    const user = this.currentUser();
    return !!(targetUID && user && targetUID === user.uid);
  });

  // Convert theme observables to signals
  // User settings (derived from query service)
  public userUnitSettings = this.userSettingsQuery.unitSettings;

  public chartTheme = toSignal(this.themeService.getChartTheme(), { initialValue: ChartThemes.Material });

  // Required for app-event-intensity-zones until it is also refactored
  public useChartAnimations = computed(() =>
    this.userSettingsQuery.chartSettings()?.useAnimations ?? false
  );

  public basicStatsTypes = [
    'Duration',
    'Distance',
    'SpeedMean',
    'HeartRateMean',
    'PowerMean',
    'Ascent',
    'Calories'
  ];

  ngOnInit() {
    this.logger.log('[EventCard] ngOnInit: initializing event details subscriptions');

    // Activity selection - debounced
    // Instant selection update
    this.activitySelectionService.selectedActivities.changed
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((change) => {
        this.selectedActivitiesInstant.set([...change.source.selected]);
      });

    // Debounced selection update for heavy components (Chart, Map)
    this.activitySelectionService.selectedActivities.changed
      .pipe(
        debounceTime(50),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((change) => {
        this.selectedActivitiesDebounced.set([...change.source.selected]);
      });

    // Route data subscription
    this.route.data
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((data: any) => {
        const resolvedData = data.event as any;
        this.logger.log('[EventCard] route.data emission received', {
          hasWrappedResolverData: !!(resolvedData && resolvedData.event),
          hasResolvedData: !!resolvedData,
        });

        if (resolvedData && resolvedData.event) {
          this.event.set(resolvedData.event);
          this.currentUser.set(resolvedData.user);
          this.logger.log('[EventCard] route.data applied wrapped resolver payload', {
            eventID: resolvedData.event?.getID?.(),
            activityCount: resolvedData.event?.getActivities?.()?.length ?? 0,
            userID: resolvedData.user?.uid ?? null,
          });
        } else {
          this.event.set(resolvedData);
          this.logger.log('[EventCard] route.data applied direct event payload', {
            eventID: resolvedData?.getID?.(),
            activityCount: resolvedData?.getActivities?.()?.length ?? 0,
          });
        }

        const activities = this.event()?.getActivities() ?? [];
        this.logger.log('[EventCard] syncing selected activities from route payload', {
          eventID: this.event()?.getID?.() ?? null,
          activityCount: activities.length,
        });
        this.syncSelectedActivities(activities);

        this.targetUserID.set(this.route.snapshot.paramMap.get('userID') ?? '');
        this.logger.log('[EventCard] target user set from route snapshot', {
          targetUserID: this.targetUserID(),
        });
        this.startEventDetailsLiveSync();
      });

    // User auth subscription
    this.authService.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user: User | null) => {
        this.currentUser.set(user);
      });
  }

  private startEventDetailsLiveSync(): void {
    const eventID = this.route.snapshot.paramMap.get('eventID');
    const targetUserID = this.route.snapshot.paramMap.get('userID');
    this.logger.log('[EventCard] startEventDetailsLiveSync called', { eventID, targetUserID });
    if (!eventID || !targetUserID) {
      this.liveSyncSubscription?.unsubscribe();
      this.liveSyncSubscription = null;
      this.liveSyncRouteKey = null;
      this.logger.log('[EventCard] live sync not started due to missing route params');
      return;
    }

    const liveSyncRouteKey = `${targetUserID}:${eventID}`;
    if (
      this.liveSyncRouteKey === liveSyncRouteKey
      && this.liveSyncSubscription
      && !this.liveSyncSubscription.closed
    ) {
      this.logger.log('[EventCard] live sync already active for route key', { liveSyncRouteKey });
      return;
    }

    this.logger.log('[EventCard] starting live sync subscription', { liveSyncRouteKey });
    this.liveSyncSubscription?.unsubscribe();
    this.liveSyncRouteKey = liveSyncRouteKey;
    this.liveSyncSubscription = this.eventService.getEventDetailsLive(new User(targetUserID), eventID)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (liveEvent) => {
          this.logger.log('[EventCard] live sync emission received', {
            eventID: liveEvent?.getID?.() ?? null,
            activityCount: liveEvent?.getActivities?.()?.length ?? 0,
          });
          this.applyLiveEventUpdate(liveEvent);
        },
        error: (error) => {
          this.logger.error('Live event details sync failed', error);
          this.snackBar.open('Could not live-sync event details', undefined, { duration: 3000 });
          this.router.navigate(['/dashboard']);
        },
      });
  }

  private applyLiveEventUpdate(liveEvent: AppEventInterface | null): void {
    if (!liveEvent) {
      this.logger.log('[EventCard] applyLiveEventUpdate skipped because liveEvent is null');
      return;
    }
    const selectedIDs = this.selectedActivitiesInstant().map((activity) => activity.getID());
    const reconcileResult = reconcileEventDetailsLiveUpdate(this.event(), liveEvent, selectedIDs);
    this.logger.log('[EventCard] reconcile result for live update', {
      incomingEventID: liveEvent.getID(),
      incomingActivityCount: liveEvent.getActivities().length,
      selectedIDs,
      nextSelectedIDs: reconcileResult.selectedActivityIDs,
      needsFullReload: reconcileResult.needsFullReload,
    });

    if (reconcileResult.needsFullReload) {
      this.logger.log('[EventCard] full reload required after live reconcile');
      this.reloadEventDetailsWithStreams();
      return;
    }

    this.event.set(reconcileResult.reconciledEvent);
    this.applySelectedActivityIDs(reconcileResult.selectedActivityIDs, true);
  }

  private async reloadEventDetailsWithStreams(): Promise<void> {
    if (this.liveReloadInProgress) {
      this.logger.log('[EventCard] reloadEventDetailsWithStreams skipped (already in progress)');
      return;
    }
    const eventID = this.route.snapshot.paramMap.get('eventID');
    const targetUserID = this.route.snapshot.paramMap.get('userID');
    if (!eventID || !targetUserID) {
      this.logger.log('[EventCard] reloadEventDetailsWithStreams skipped due to missing route params', { eventID, targetUserID });
      return;
    }

    const previousSelectedIDs = this.selectedActivitiesInstant().map((activity) => activity.getID());
    const streamTypes = this.getLiveStreamTypes();
    this.logger.log('[EventCard] reloadEventDetailsWithStreams started', {
      eventID,
      targetUserID,
      previousSelectedIDs,
      streamTypes,
    });
    this.liveReloadInProgress = true;
    try {
      const refreshedEvent = await firstValueFrom(
        this.eventService.getEventActivitiesAndSomeStreams(
          new User(targetUserID),
          eventID,
          streamTypes,
        ),
      );
      if (!refreshedEvent) {
        this.logger.log('[EventCard] reloadEventDetailsWithStreams completed with null refreshedEvent');
        return;
      }

      this.event.set(refreshedEvent as AppEventInterface);
      const refreshedActivityIDs = (refreshedEvent.getActivities() || []).map((activity) => activity.getID());
      const refreshedIDSet = new Set(refreshedActivityIDs);
      const preservedIDs = previousSelectedIDs.filter((activityID) => refreshedIDSet.has(activityID));
      const nextSelectedIDs = preservedIDs.length || previousSelectedIDs.length === 0
        ? preservedIDs
        : refreshedActivityIDs;
      this.logger.log('[EventCard] reloadEventDetailsWithStreams refreshed event applied', {
        refreshedEventID: refreshedEvent.getID(),
        refreshedActivityIDs,
        nextSelectedIDs,
      });

      this.applySelectedActivityIDs(nextSelectedIDs, true);
    } catch (error) {
      this.logger.error('Could not refresh event details after live reconcile mismatch', error);
      this.snackBar.open('Could not refresh event details', undefined, { duration: 3000 });
      this.router.navigate(['/dashboard']);
    } finally {
      this.liveReloadInProgress = false;
    }
  }

  private applySelectedActivityIDs(selectedActivityIDs: string[], forceRebind: boolean = false): void {
    const selectedSet = new Set(selectedActivityIDs);
    const activities = this.event()?.getActivities() ?? [];
    const selectedActivities = activities.filter((activity) => selectedSet.has(activity.getID()));

    if (!forceRebind && this.hasSameSelectedActivities(selectedActivities)) {
      return;
    }

    this.syncSelectedActivities(selectedActivities);
  }

  private syncSelectedActivities(selectedActivities: ActivityInterface[]): void {
    this.logger.log('[EventCard] syncSelectedActivities called', {
      incomingSelectionCount: selectedActivities.length,
      incomingSelectionIDs: selectedActivities.map((activity) => activity.getID()),
    });
    const nextSelection = [...selectedActivities];
    this.activitySelectionService.selectedActivities.clear(false);
    if (nextSelection.length > 0) {
      this.activitySelectionService.selectedActivities.select(...nextSelection);
    }

    this.selectedActivitiesInstant.set(nextSelection);
    this.selectedActivitiesDebounced.set(nextSelection);
  }

  private hasSameSelectedActivities(nextActivities: ActivityInterface[]): boolean {
    const currentActivities = this.selectedActivitiesInstant();
    if (currentActivities.length !== nextActivities.length) {
      return false;
    }

    for (let index = 0; index < currentActivities.length; index++) {
      const current = currentActivities[index];
      const next = nextActivities[index];
      const currentID = current?.getID?.();
      const nextID = next?.getID?.();

      if (currentID && nextID) {
        if (currentID !== nextID) {
          return false;
        }
        continue;
      }

      if (current !== next) {
        return false;
      }
    }

    return true;
  }

  private getLiveStreamTypes(): string[] {
    const streamTypes = [
      DataLatitudeDegrees.type,
      DataLongitudeDegrees.type,
      DataSpeed.type,
      DataGradeAdjustedSpeed.type,
      DataDistance.type,
    ];

    const user = this.currentUser();
    if (user) {
      const userChartDataTypes = this.userService.getUserChartDataTypesToUse(user);
      const nonUnitBasedDataTypes = DynamicDataLoader.getNonUnitBasedDataTypes(
        user.settings.chartSettings.showAllData,
        userChartDataTypes,
      );
      nonUnitBasedDataTypes.forEach((type) => {
        if (!streamTypes.includes(type)) {
          streamTypes.push(type);
        }
      });
    }

    this.logger.log('[EventCard] computed live stream types', { streamTypes });
    return streamTypes;
  }

}
