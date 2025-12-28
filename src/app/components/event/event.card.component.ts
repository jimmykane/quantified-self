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

import { ActivityInterface } from '@sports-alliance/sports-lib';
import { EventInterface } from '@sports-alliance/sports-lib';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAuthService } from '../../authentication/app.auth.service';
import { User } from '@sports-alliance/sports-lib';
import {
  ChartCursorBehaviours,
  ChartThemes,
  XAxisTypes
} from '@sports-alliance/sports-lib';
import { AppThemeService } from '../../services/app.theme.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { MapThemes } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../services/app.user.service';
import { AppActivitySelectionService } from '../../services/activity-selection-service/app-activity-selection.service';
import { LapTypes } from '@sports-alliance/sports-lib';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { LoggerService } from '../../services/logger.service';


@Component({
  selector: 'app-event-card',
  templateUrl: './event.card.component.html',
  styleUrls: ['./event.card.component.css'],
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
  private snackBar = inject(MatSnackBar);
  private themeService = inject(AppThemeService);
  private bottomSheet = inject(MatBottomSheet);
  private logger = inject(LoggerService);

  // Signal-based state
  public event = signal<EventInterface | null>(null);
  public currentUser = signal<User | null>(null);
  public selectedActivitiesInstant = signal<ActivityInterface[]>([]);
  public selectedActivitiesDebounced = signal<ActivityInterface[]>([]);
  public isDownloading = signal<boolean>(false);
  public targetUserID = signal<string>('');

  // Computed signals for template - replaces method calls
  public hasLapsFlag = computed(() =>
    this.event()?.getActivities().some(a => a.getLaps().length > 0) ?? false
  );

  public hasIntensityZonesFlag = computed(() =>
    this.event()?.getActivities().some(a => a.intensityZones?.length > 0) ?? false
  );

  public hasDevicesFlag = computed(() =>
    this.event()?.getActivities().some(a => a.creator?.devices?.length > 0) ?? false
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
  public chartTheme = toSignal(this.themeService.getChartTheme(), { initialValue: ChartThemes.Material });
  public appTheme = toSignal(this.themeService.getAppTheme(), { initialValue: AppThemes.Normal });
  public mapTheme = toSignal(this.themeService.getMapTheme(), { initialValue: MapThemes.Normal });

  // User settings (derived from currentUser signal)
  public userUnitSettings = computed(() =>
    this.currentUser()?.settings?.unitSettings ?? AppUserService.getDefaultUserUnitSettings()
  );

  public chartXAxisType = computed(() =>
    this.currentUser()?.settings?.chartSettings?.xAxisType ?? XAxisTypes.Duration
  );

  public chartDownSamplingLevel = computed(() =>
    this.currentUser()?.settings?.chartSettings?.downSamplingLevel ?? AppUserService.getDefaultDownSamplingLevel()
  );

  public chartGainAndLossThreshold = computed(() =>
    this.currentUser()?.settings?.chartSettings?.gainAndLossThreshold ?? AppUserService.getDefaultGainAndLossThreshold()
  );

  public chartCursorBehaviour = computed(() =>
    this.currentUser()?.settings?.chartSettings?.chartCursorBehaviour ?? AppUserService.getDefaultChartCursorBehaviour()
  );

  public showAllData = computed(() =>
    this.currentUser()?.settings?.chartSettings?.showAllData ?? false
  );

  public useChartAnimations = computed(() =>
    this.currentUser()?.settings?.chartSettings?.useAnimations ?? false
  );

  public chartDisableGrouping = computed(() =>
    this.currentUser()?.settings?.chartSettings?.disableGrouping ?? false
  );

  public showMapLaps = computed(() =>
    this.currentUser()?.settings?.mapSettings?.showLaps ?? true
  );

  public showMapPoints = computed(() =>
    this.currentUser()?.settings?.mapSettings?.showPoints ?? false
  );

  public showChartLaps = computed(() =>
    this.currentUser()?.settings?.chartSettings?.showLaps ?? true
  );

  public showChartGrid = computed(() =>
    this.currentUser()?.settings?.chartSettings?.showGrid ?? true
  );

  public stackChartYAxes = computed(() =>
    this.currentUser()?.settings?.chartSettings?.stackYAxes ?? true
  );

  public chartHideAllSeriesOnInit = computed(() =>
    this.currentUser()?.settings?.chartSettings?.hideAllSeriesOnInit ?? false
  );

  public showMapArrows = computed(() =>
    this.currentUser()?.settings?.mapSettings?.showArrows ?? true
  );

  public mapStrokeWidth = computed(() =>
    this.currentUser()?.settings?.mapSettings?.strokeWidth ?? AppUserService.getDefaultMapStrokeWidth()
  );

  public mapLapTypes = computed<LapTypes[]>(() =>
    this.currentUser()?.settings?.mapSettings?.lapTypes ?? AppUserService.getDefaultMapLapTypes()
  );

  public chartLapTypes = computed<LapTypes[]>(() =>
    this.currentUser()?.settings?.chartSettings?.lapTypes ?? AppUserService.getDefaultChartLapTypes()
  );

  public chartStrokeWidth = computed(() =>
    this.currentUser()?.settings?.chartSettings?.strokeWidth ?? AppUserService.getDefaultChartStrokeWidth()
  );

  public chartStrokeOpacity = computed(() =>
    this.currentUser()?.settings?.chartSettings?.strokeOpacity ?? AppUserService.getDefaultChartStrokeOpacity()
  );

  public chartFillOpacity = computed(() =>
    this.currentUser()?.settings?.chartSettings?.fillOpacity ?? AppUserService.getDefaultChartFillOpacity()
  );

  public chartExtraMaxForPower = computed(() =>
    this.currentUser()?.settings?.chartSettings?.extraMaxForPower ?? AppUserService.getDefaultExtraMaxForPower()
  );

  public chartExtraMaxForPace = computed(() =>
    this.currentUser()?.settings?.chartSettings?.extraMaxForPace ?? AppUserService.getDefaultExtraMaxForPace()
  );

  public chartDataTypesToUse = computed(() => {
    const user = this.currentUser();
    return user ? this.userService.getUserChartDataTypesToUse(user) : [];
  });

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

        if (resolvedData && resolvedData.event) {
          this.event.set(resolvedData.event);
          this.currentUser.set(resolvedData.user);
        } else {
          this.event.set(resolvedData);
        }

        this.logger.log('[EventCard] Event data loaded:', this.event());

        this.activitySelectionService.selectedActivities.clear();
        const activities = this.event()?.getActivities() ?? [];
        this.activitySelectionService.selectedActivities.select(...activities);
        // Initial set for both
        this.selectedActivitiesInstant.set(activities);
        this.selectedActivitiesDebounced.set(activities);

        this.targetUserID.set(this.route.snapshot.paramMap.get('userID') ?? '');
      });

    // User auth subscription
    this.authService.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user: User | null) => {
        this.currentUser.set(user);
      });
  }
}
