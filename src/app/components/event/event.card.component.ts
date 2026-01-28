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
import { AppUserService } from '../../services/app.user.service';
import { AppActivitySelectionService } from '../../services/activity-selection-service/app-activity-selection.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
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
  private userSettingsQuery = inject(AppUserSettingsQueryService);
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
