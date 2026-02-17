import { Component, Inject, ViewChild, ElementRef, ChangeDetectorRef, NgZone, effect, signal, WritableSignal, computed, PLATFORM_ID, OnInit, OnDestroy, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { AppEventService } from '../../services/app.event.service';
import { take, debounceTime, filter } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppUserInterface } from '../../models/app-user.interface';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { Subject, Subscription } from 'rxjs';
import { DateRanges, ActivityTypes } from '@sports-alliance/sports-lib';
import { DataStartPosition } from '@sports-alliance/sports-lib';
import { DataPositionInterface } from '@sports-alliance/sports-lib';
import { DataJumpEvent } from '@sports-alliance/sports-lib';
import { getDatesForDateRange } from '../../helpers/date-range-helper';
import { AppFileService } from '../../services/app.file.service';
import { DataLatitudeDegrees } from '@sports-alliance/sports-lib';
import { DataLongitudeDegrees } from '@sports-alliance/sports-lib';
import { GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES } from '@sports-alliance/sports-lib';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MyTracksProgressComponent } from './progress/tracks.progress';
import { Overlay } from '@angular/cdk/overlay';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppUserService } from '../../services/app.user.service';
import { WhereFilterOp } from 'firebase/firestore';
import { MapboxLoaderService } from '../../services/mapbox-loader.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { AppMyTracksSettings } from '../../models/app-user.interface';
import { LoggerService } from '../../services/logger.service';
import { TracksMapManager } from './tracks-map.manager'; // Imported Manager
import { MapStyleService } from '../../services/map-style.service';
import { MapboxStyleSynchronizer } from '../../services/map/mapbox-style-synchronizer';
import { MapStyleName } from '../../services/map/map-style.types';
import { MapboxHeatmapLayerService } from '../../services/map/mapbox-heatmap-layer.service';
import { JumpHeatmapWeightingService } from '../../services/map/jump-heatmap-weighting.service';
import { Search } from '../event-search/event-search.component';
import { MyTracksTripDetectionService } from '../../services/my-tracks-trip-detection.service';
import { TripDetectionInput } from '../../services/my-tracks-trip-detection.service';
import { DetectedTrip } from '../../services/my-tracks-trip-detection.service';
import { ResolvedTripLocationLabel, TripLocationLabelService } from '../../services/trip-location-label.service';

interface DetectedTripViewModel extends DetectedTrip {
  locationLabel: string | null;
}

interface JumpHeatPoint {
  lng: number;
  lat: number;
  hangTime: number | null;
  distance: number | null;
}

interface JumpHeatCollectionStats {
  jumpsWithCoordinates: number;
  jumpsWithWeightMetrics: number;
}

@Component({
  selector: 'app-tracks',
  templateUrl: './tracks.component.html',
  styleUrls: ['./tracks.component.scss'],
  standalone: false
})
export class TracksComponent implements OnInit, OnDestroy {
  @ViewChild('mapDiv', { static: true }) mapDiv!: ElementRef;

  public dateRangesToShow: DateRanges[] = [
    DateRanges.thisWeek,
    DateRanges.lastWeek,
    DateRanges.lastSevenDays,
    DateRanges.thisMonth,
    DateRanges.lastMonth,
    DateRanges.lastThirtyDays,
    DateRanges.thisYear,
    DateRanges.lastYear,
    DateRanges.all
  ]
  bufferProgress = new Subject<number>();
  totalProgress = new Subject<number>();

  public user: AppUserInterface | undefined;

  private mapSignal = signal<any>(null); // Signal to hold map instance for reactive synchronization
  private userSignal = signal<AppUserInterface | undefined>(undefined);
  private tracksMapManager: TracksMapManager;
  private scrolled = false;
  private hasTrackBoundsBeenApplied = false;
  private trackCoordinatesByEventId = new Map<string, number[][]>();

  private eventsSubscription: Subscription = new Subscription();
  private trackLoadingSubscription: Subscription = new Subscription();

  private mapSynchronizer = signal<MapboxStyleSynchronizer | undefined>(undefined);
  private terrainControl = signal<any>(null); // Using any to avoid forward reference issues if class is defined below
  private platformId!: object;

  private promiseTime!: number;
  private analyticsService = inject(AppAnalyticsService);
  private userSettingsQuery = inject(AppUserSettingsQueryService);
  private logger = inject(LoggerService);
  private tripDetectionService = inject(MyTracksTripDetectionService);
  private tripLocationLabelService = inject(TripLocationLabelService);

  public isLoading: WritableSignal<boolean> = signal(false);
  public detectedTrips: WritableSignal<DetectedTripViewModel[]> = signal([]);
  public hasEvaluatedTripDetection: WritableSignal<boolean> = signal(false);
  public detectedTripsPanelExpanded: WritableSignal<boolean> = signal(false);
  public searchPeekDefaultExpanded: WritableSignal<boolean> = signal(true);
  public hasDetectedJumps: WritableSignal<boolean> = signal(false);
  // Removed legacy state tracking

  constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private eventService: AppEventService,
    private authService: AppAuthService,
    private router: Router,
    private eventColorService: AppEventColorService,
    private zone: NgZone,
    private fileService: AppFileService,
    private bottomSheet: MatBottomSheet,
    private overlay: Overlay,
    private userService: AppUserService,
    private snackBar: MatSnackBar,
    private mapboxLoader: MapboxLoaderService,
    private themeService: AppThemeService,
    private mapStyleService: MapStyleService,
    private mapboxHeatmapLayerService: MapboxHeatmapLayerService,
    private jumpHeatmapWeightingService: JumpHeatmapWeightingService,
  ) {
    this.tracksMapManager = new TracksMapManager(
      this.zone,
      this.eventColorService,
      this.mapStyleService,
      this.mapboxHeatmapLayerService,
      this.jumpHeatmapWeightingService,
      this.logger
    );
    this.tracksMapManager.setIsDarkTheme(this.themeService.appTheme() === AppThemes.Dark);

    const platformId = inject(PLATFORM_ID);
    this.platformId = platformId;
    this.searchPeekDefaultExpanded.set(this.resolveDesktopViewportDefault());

    // Track last settings to prevent redundant data fetching
    let lastLoadedDataSettings: { dateRange: DateRanges, activityTypes?: ActivityTypes[] } | null = null;
    let isFirstRun = true;

    // Unified Reactive State: Combines Settings and Theme
    const viewState = computed(() => {
      const settings = this.userSettingsQuery.myTracksSettings() as AppMyTracksSettings;
      const theme = this.themeService.appTheme();
      return { settings, theme };
    });

    // Single Effect to drive Map State
    effect(() => {
      const { settings, theme } = viewState();
      const map = this.mapSignal();
      const user = this.userSignal();
      const synchronizer = this.mapSynchronizer();
      const terrainControl = this.terrainControl();

      if (!map || !synchronizer || !settings || !user) return;

      // 1. Update Map Style via Synchronizer
      const mapStyle = settings.mapStyle || 'default';
      this.tracksMapManager.setMapStyle(mapStyle as MapStyleName);
      const resolved = this.mapStyleService.resolve(mapStyle, theme);
      synchronizer.update(resolved);

      // 2. Update Tracks Colors (Theme based)
      this.tracksMapManager.setIsDarkTheme(theme === AppThemes.Dark);
      this.tracksMapManager.refreshTrackColors();
      this.tracksMapManager.setJumpHeatmapVisible(settings.showJumpHeatmap !== false);

      // 3. Terrain (is3D)
      if (terrainControl) {
        this.tracksMapManager.toggleTerrain(!!settings.is3D, !isFirstRun);
      }
      isFirstRun = false;

      // 4. Data Loading
      // Check if data-impacting settings changed
      const currentSnapshot = { dateRange: settings.dateRange, activityTypes: settings.activityTypes };

      const dataChanged = !lastLoadedDataSettings ||
        lastLoadedDataSettings.dateRange !== currentSnapshot.dateRange ||
        JSON.stringify(lastLoadedDataSettings.activityTypes) !== JSON.stringify(currentSnapshot.activityTypes);

      if (dataChanged) {
        lastLoadedDataSettings = currentSnapshot;
        this.isLoading.set(true);
        this.loadTracksMapForUserByDateRange(user, settings.dateRange, settings.activityTypes)
          .catch(err => this.logger.error('Error loading tracks', err))
          .finally(() => this.isLoading.set(false));
      }
    });
  }

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      // --- Constructor Style Injection ---
      // Resolve user's preferred style BEFORE creating the map.
      const initialSettings = this.userSettingsQuery.myTracksSettings() as AppMyTracksSettings;
      const prefMapStyle = initialSettings?.mapStyle || 'default';
      const initialTheme = this.themeService.appTheme();
      const resolved = this.mapStyleService.resolve(prefMapStyle as any, initialTheme);
      const initialStyleUrl = resolved.styleUrl;

      // Removed manualStyleOverride logic

      const mapOptions: any = {
        zoom: 1.5,
        center: [0, 20],
        style: initialStyleUrl // Pass user's preferred style directly
      };
      if (this.mapStyleService.isStandard(initialStyleUrl) && resolved.preset) {
        mapOptions.config = { basemap: { lightPreset: resolved.preset } };
      }

      // Run Mapbox initialization entirely outside Angular to prevent Map events from triggering CD
      await this.zone.runOutsideAngular(async () => {
        const mapInstance = await this.mapboxLoader.createMap(this.mapDiv.nativeElement, mapOptions);
        this.mapSignal.set(mapInstance);

        // Initialize Synchronizer
        this.mapSynchronizer.set(this.mapStyleService.createSynchronizer(mapInstance));
        // We don't call update(resolved) here because the effect will trigger automatically 
        // as soon as mapSignal and mapSynchronizer are both set.

        const mapboxgl = await this.mapboxLoader.loadMapbox();
        this.tracksMapManager.setMap(mapInstance, mapboxgl);
        this.tracksMapManager.setIsDarkTheme(this.themeService.appTheme() === AppThemes.Dark);

        mapInstance.addControl(new mapboxgl.FullscreenControl(), 'bottom-right');

        // Standard Navigation Control for Zoom and Rotation (Pitch)
        const navControl = new mapboxgl.NavigationControl({
          visualizePitch: true,
          showCompass: true,
          showZoom: true
        });
        mapInstance.addControl(navControl, 'bottom-right');

        this.centerMapToStartingLocation(mapInstance);
        this.eventsSubscription.add(
          this.authService.user$
            .pipe(
              filter((authUser): authUser is AppUserInterface => !!authUser),
              take(1),
            )
            .subscribe((authUser) => {
              this.user = authUser;
              this.userSignal.set(authUser);
            })
        );

        // Restore terrain control (initialSettings already loaded above)
        // Initialize 3D state immediately for responsiveness and test compliance
        const control = new TerrainControl(!!initialSettings?.is3D, (is3D) => {
          // Toggle map locally immediately for responsiveness
          this.tracksMapManager.toggleTerrain(is3D, true);

          if (is3D) {
            this.zone.run(() => {
              this.snackBar.open('Use Ctrl + Left Click (or Right Click) + Drag to rotate and tilt the map in 3D.', 'OK', {
                duration: 5000,
                verticalPosition: 'top'
              });
            });
          }

          // Persist 3D setting via service
          this.userSettingsQuery.updateMyTracksSettings({ is3D });
        });
        this.terrainControl.set(control);
        mapInstance.addControl(control, 'bottom-right');
        this.tracksMapManager.setTerrainControl(control);

        // Restore terrain control (initialSettings already loaded above)
        // Initialize 3D state - The effect handles the initial toggleTerrain call.
      });

    } catch (error) {
      this.logger.error('Failed to initialize Mapbox:', error);
    }
  }

  public setMapStyle(styleType: 'default' | 'satellite' | 'outdoors') {
    // Just update settings. The effect handles the rest.
    this.userSettingsQuery.updateMyTracksSettings({ mapStyle: styleType });
    this.logger.info('[TracksComponent] User selected map style', { styleType });
  }

  public isJumpHeatmapEnabled(): boolean {
    const settings = this.userSettingsQuery.myTracksSettings() as AppMyTracksSettings;
    return settings?.showJumpHeatmap !== false;
  }

  public toggleJumpHeatmap(): void {
    this.onShowJumpHeatmapToggle(!this.isJumpHeatmapEnabled());
  }

  public onShowJumpHeatmapToggle(checked: boolean) {
    this.userSettingsQuery.updateMyTracksSettings({ showJumpHeatmap: checked });
  }

  public async search(event: Search) {
    if (!isPlatformBrowser(this.platformId)) return;

    // Update user settings - this will trigger signal -> effect
    // AppUserSettingsQueryService handles persistence to backend.
    this.userSettingsQuery.updateMyTracksSettings({
      dateRange: event.dateRange,
      activityTypes: event.activityTypes
    });

    // Manually clean legacy subscription if it exists, though effect handles fresh load
    if (this.trackLoadingSubscription) {
      this.trackLoadingSubscription.unsubscribe();
    }

    this.analyticsService.logEvent('my_tracks_search', { method: DateRanges[event.dateRange] });
  }

  public ngOnDestroy() {
    this.unsubscribeFromAll()
    this.bottomSheet.dismiss();
    if (this.mapSignal()) {
      this.mapSignal().remove();
    }
  }

  private unsubscribeFromAll() {
    if (this.eventsSubscription) {
      this.eventsSubscription.unsubscribe();
      // No need to re-initialize eventsSubscription here, as it's a parent for all component-level subscriptions
      // and will be fully disposed on ngOnDestroy.
    }
    if (this.trackLoadingSubscription) {
      this.trackLoadingSubscription.unsubscribe();
    }
  }

  private clearProgressAndOpenBottomSheet() {
    this.updateBufferProgress(0);
    this.updateTotalProgress(0);
    this.bottomSheet.open(MyTracksProgressComponent, {
      data: {
        totalProgress: this.totalProgress,
        bufferProgress: this.bufferProgress,
      },
      disableClose: true,
      hasBackdrop: false,
      closeOnNavigation: true,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
    });
  }

  private clearProgressAndCloseBottomSheet() {
    this.updateBufferProgress(0);
    this.updateTotalProgress(0);
    if (this.bottomSheet) {
      this.bottomSheet.dismiss()
    }
  }




  private async loadTracksMapForUserByDateRange(user: AppUserInterface | undefined, dateRange: DateRanges, activityTypes?: ActivityTypes[]) {
    if (!user) {
      this.logger.warn('[TracksComponent] Skipping track load because user is undefined.');
      return;
    }
    this.logger.log('[TracksComponent] Starting track load for trip detection.', {
      dateRange: DateRanges[dateRange],
      activityTypes: activityTypes || [],
      userId: (user as any).uid || (user as any).id || 'unknown'
    });
    this.hasTrackBoundsBeenApplied = true;
    const promiseTime = new Date().getTime();
    this.promiseTime = promiseTime
    this.hasEvaluatedTripDetection.set(false);
    this.detectedTrips.set([]);
    this.detectedTripsPanelExpanded.set(false);
    this.hasDetectedJumps.set(false);
    this.trackCoordinatesByEventId.clear();
    this.tracksMapManager.clearJumpHeatmap();
    this.clearProgressAndOpenBottomSheet();
    const dates = getDatesForDateRange(dateRange, user.settings?.unitSettings?.startOfTheWeek || 1);
    const where = []
    if (dates.startDate) {
      where.push({
        fieldPath: 'startDate',
        opStr: <WhereFilterOp>'>=',
        value: dates.startDate.getTime()
      });
    }
    if (dates.endDate) {
      where.push({
        fieldPath: 'startDate',
        opStr: <WhereFilterOp>'<=', // Should remove mins from date
        value: dates.endDate.getTime()
      })
    }

    this.logger.log(`[TracksComponent] Initializing fetch from event service for dateRange: ${DateRanges[dateRange]}, activityTypes: ${activityTypes?.[0] || 'all'}, promiseTime: ${promiseTime}`);

    this.trackLoadingSubscription = this.eventService.getEventsBy(user, where, 'startDate', true, 0)
      .pipe(
        debounceTime(300),
        take(1), // Fix: Avoid double emission (cache + server) and prevent memory leaks if subscription is not cleared
      )
      .subscribe(async (events) => {
        this.logger.log(`[TracksComponent] eventService.getEventsBy emitted ${events?.length || 0} events for promiseTime: ${promiseTime}`);
        try {
          events = (events || []).filter((event) => !event.isMerge).filter((event) => event.getStat(DataStartPosition.type));
          if (!events || !events.length) {
            if (this.promiseTime !== promiseTime) {
              return;
            }
            this.tracksMapManager.clearAllTracks();
            this.hasDetectedJumps.set(false);
            this.hasEvaluatedTripDetection.set(true);
            this.clearProgressAndCloseBottomSheet();
            return;
          }

          const chuckArraySize = 15;
          const chunckedEvents: any[][] = events.reduce((all: any[][], one: any, i: number) => {
            const ch = Math.floor(i / chuckArraySize);
            all[ch] = ([] as any[]).concat((all[ch] || []), one);
            return all
          }, [])

          this.updateBufferProgress(100);

          if (this.promiseTime !== promiseTime) {
            return;
          }
          let count = 0;
          let addedTrackCount = 0;
          const allCoordinates: number[][] = [];
          const jumpHeatPoints: JumpHeatPoint[] = [];
          let jumpsWithCoordinates = 0;
          let jumpsWithWeightMetrics = 0;
          const detectionCandidatesByEvent = new Map<string, TripDetectionInput>();

          for (const eventsChunk of chunckedEvents) {
            if (this.promiseTime !== promiseTime) {
              return;
            }

            const chunkCoordinates: number[][] = [];

            await Promise.all(eventsChunk.map(async (event: any) => {
              this.logger.log(`[TracksComponent] Fetching activities and streams for event: ${event.getID()}, promiseTime: ${promiseTime}`);
              event.addActivities(await this.eventService.getActivities(user, event.getID()).pipe(take(1)).toPromise())
              return this.eventService.attachStreamsToEventWithActivities(user, event, [
                DataLatitudeDegrees.type,
                DataLongitudeDegrees.type,
              ]).pipe(take(1)).toPromise()
                .then((fullEvent: any) => {
                  this.logger.log(`[TracksComponent] Attached streams for event: ${event.getID()}, promiseTime: ${promiseTime}`);
                  if (this.promiseTime !== promiseTime) {
                    return
                  }
                  const eventId = fullEvent?.getID?.() || event.getID();
                  let hasVisibleTrackForEvent = false;
                  const eventCoordinates: number[][] = [];
                  fullEvent.getActivities()
                    .filter((activity: any) => activity.hasPositionData())
                    .filter((activity: any) => !activityTypes || activityTypes.length === 0 || activityTypes.includes(activity.type))
                    .forEach((activity: any) => {
                      const jumpStats = this.collectJumpHeatPointsFromActivity(activity, jumpHeatPoints);
                      jumpsWithCoordinates += jumpStats.jumpsWithCoordinates;
                      jumpsWithWeightMetrics += jumpStats.jumpsWithWeightMetrics;

                      const coordinates = activity.getPositionData()
                        .filter((position: any) => position)
                        .map((position: any) => {
                          // Mapbox uses [lng, lat]
                          const lng = Math.round(position.longitudeDegrees * Math.pow(10, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES)) / Math.pow(10, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES);
                          const lat = Math.round(position.latitudeDegrees * Math.pow(10, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES)) / Math.pow(10, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES);
                          return [lng, lat];
                        })
                        .filter((coordinate: number[]) =>
                          Number.isFinite(coordinate[0])
                          && Number.isFinite(coordinate[1])
                          && Math.abs(coordinate[0]) <= 180
                          && Math.abs(coordinate[1]) <= 90
                        );

                      if (coordinates.length > 1) {
                        this.tracksMapManager.addTrackFromActivity(activity, coordinates);
                        addedTrackCount++;
                        hasVisibleTrackForEvent = true;
                        coordinates.forEach((coordinate: number[]) => {
                          chunkCoordinates.push(coordinate);
                          allCoordinates.push(coordinate);
                          eventCoordinates.push(coordinate);
                        });
                      }
                    })

                  if (hasVisibleTrackForEvent) {
                    this.trackCoordinatesByEventId.set(eventId, eventCoordinates);
                    const detectionInput = this.getTripDetectionInputFromEvent(fullEvent || event);
                    if (detectionInput) {
                      detectionCandidatesByEvent.set(detectionInput.eventId, detectionInput);
                    }
                  }

                  count++;
                  this.updateTotalProgress(Math.ceil((count / events.length) * 100))
                })
            }))

            if (count < events.length && chunkCoordinates.length > 0) {
              this.fitBoundsToTracks(chunkCoordinates);
            }
          }

          if (allCoordinates.length > 0) {
            this.fitBoundsToTracks(allCoordinates);
          }
          if (addedTrackCount === 0) {
            this.tracksMapManager.clearAllTracks();
          }
          if (jumpHeatPoints.length > 0) {
            this.hasDetectedJumps.set(true);
            this.tracksMapManager.setJumpHeatPoints(jumpHeatPoints);
          } else {
            this.hasDetectedJumps.set(false);
            this.tracksMapManager.clearJumpHeatmap();
          }
          this.logger.log('[TracksComponent] Jump heatmap collection summary.', {
            jumpsWithCoordinates,
            jumpsWithWeightMetrics,
            renderableHeatPoints: jumpHeatPoints.length,
            promiseTime
          });
          this.logger.log('[TracksComponent] Prepared trip detection candidates.', {
            candidateCount: detectionCandidatesByEvent.size,
            promiseTime
          });
          await this.updateDetectedTripsForCurrentLoad(Array.from(detectionCandidatesByEvent.values()), promiseTime);
        } catch (e) {
          this.logger.error('Error loading tracks', e);
        } finally {
          if (this.promiseTime === promiseTime) {
            this.clearProgressAndCloseBottomSheet();
          }
        }
      });
  }

  private clearAllPolylines() {
    this.tracksMapManager.clearAllTracks();
  }

  private centerMapToStartingLocation(map: any) {
    if (isPlatformBrowser(this.platformId)) {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
          if (this.scrolled || this.hasTrackBoundsBeenApplied) return;

          map.flyTo({
            center: [pos.coords.longitude, pos.coords.latitude], // Mapbox is [lng, lat]
            zoom: 9,
            essential: true
          });

          // noMoveStart doesn't seem to have an effect, see Leaflet
          // issue: https://github.com/Leaflet/Leaflet/issues/5396
          this.clearScroll(map);
        });
      }
    }
  }

  private fitBoundsToTracks(coordinates: number[][]) {
    if (!coordinates || coordinates.length === 0) return;
    this.hasTrackBoundsBeenApplied = true;
    this.tracksMapManager.fitBoundsToCoordinates(coordinates);
  }

  public onDetectedTripSelected(trip: DetectedTripViewModel): void {
    const eventBasedCoordinates = (trip.eventIds || [])
      .flatMap((eventId) => this.trackCoordinatesByEventId.get(eventId) || []);

    if (eventBasedCoordinates.length > 0) {
      this.fitBoundsToTracks(eventBasedCoordinates);
      return;
    }

    this.fitBoundsToTracks([
      [trip.bounds.west, trip.bounds.south],
      [trip.bounds.east, trip.bounds.north],
    ]);
  }

  private getTripDetectionInputFromEvent(event: any): TripDetectionInput | null {
    const eventId = event?.getID?.();
    const startPositionStat = event?.getStat?.(DataStartPosition.type) as DataStartPosition | undefined;
    const startPosition = startPositionStat?.getValue?.() as DataPositionInterface | undefined;
    if (!eventId || !startPosition) return null;

    const latitudeDegrees = startPosition.latitudeDegrees;
    const longitudeDegrees = startPosition.longitudeDegrees;

    if (!Number.isFinite(latitudeDegrees) || !Number.isFinite(longitudeDegrees)) {
      return null;
    }

    if (Math.abs(latitudeDegrees) > 90 || Math.abs(longitudeDegrees) > 180) {
      return null;
    }

    return {
      eventId,
      startDate: event?.startDate,
      latitudeDegrees,
      longitudeDegrees,
    };
  }

  private async updateDetectedTripsForCurrentLoad(candidates: TripDetectionInput[], promiseTime: number): Promise<void> {
    this.logger.log('[TracksComponent] Running trip detection update.', {
      candidateCount: candidates.length,
      promiseTime,
      currentPromiseTime: this.promiseTime
    });
    const detectedTrips = this.tripDetectionService.detectTrips(candidates);
    const viewModels = await Promise.all(detectedTrips.map(async (trip) => {
      const location = await this.tripLocationLabelService.resolveTripLocation(trip.centroidLat, trip.centroidLng);

      return {
        ...trip,
        locationLabel: location?.label || null,
      } satisfies DetectedTripViewModel;
    }));

    if (this.promiseTime !== promiseTime) {
      this.logger.warn('[TracksComponent] Skipping detected trips update due to stale promiseTime.', {
        promiseTime,
        currentPromiseTime: this.promiseTime,
        detectedTripCount: viewModels.length
      });
      return;
    }

    this.detectedTrips.set(viewModels);
    this.detectedTripsPanelExpanded.set(viewModels.length > 0);
    this.hasEvaluatedTripDetection.set(true);
    this.logger.log('[TracksComponent] Detected trips committed to UI state.', {
      detectedTripCount: viewModels.length,
      panelExpanded: this.detectedTripsPanelExpanded()
    });
  }

  private markScrolled(map: any) {
    map.off('movestart', this.onMoveStart);
    this.scrolled = true;
  }

  // Bound function to be able to remove listener
  private onMoveStart = () => {
    this.markScrolled(this.mapSignal());
  }

  private clearScroll(map: any) {
    this.scrolled = false;
    map.on('movestart', this.onMoveStart);
  }

  private updateBufferProgress(value: number) {
    this.bufferProgress.next(value)
  }

  private updateTotalProgress(value: number) {
    this.totalProgress.next(value);
  }

  private collectJumpHeatPointsFromActivity(activity: any, jumpHeatPoints: JumpHeatPoint[]): JumpHeatCollectionStats {
    let jumpsWithCoordinates = 0;
    let jumpsWithWeightMetrics = 0;
    const activityEvents = typeof activity?.getAllEvents === 'function' ? activity.getAllEvents() : [];
    (activityEvents || []).forEach((activityEvent: any) => {
      const jumpData = activityEvent instanceof DataJumpEvent ? activityEvent.jumpData : activityEvent?.jumpData;
      const lat = this.getNumericJumpStatValue(jumpData?.position_lat);
      const lng = this.getNumericJumpStatValue(jumpData?.position_long);
      if (lat === null || lng === null) {
        return;
      }
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return;
      }
      jumpsWithCoordinates++;

      const hangTime = this.getNumericJumpStatValue(jumpData?.hang_time);
      const distance = this.getNumericJumpStatValue(jumpData?.distance);
      if (hangTime === null && distance === null) {
        return;
      }
      jumpsWithWeightMetrics++;
      jumpHeatPoints.push({
        lng,
        lat,
        hangTime,
        distance
      });
    });
    return {
      jumpsWithCoordinates,
      jumpsWithWeightMetrics
    };
  }

  private getNumericJumpStatValue(stat: any): number | null {
    const value = stat?.getValue?.();
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return null;
  }

  // Refactored helpers
  private isStyleLoaded(): boolean {
    return this.mapSignal() && this.mapSignal().isStyleLoaded();
  }

  private resolveDesktopViewportDefault(): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return true;
    }

    const mediaQuery = window.matchMedia?.('(min-width: 641px)');
    if (mediaQuery) {
      return mediaQuery.matches;
    }

    return window.innerWidth >= 641;
  }
}

class TerrainControl {
  private map: any;
  private container: HTMLElement | undefined;
  private icon: HTMLElement | undefined;

  constructor(private is3D: boolean, private onToggle: (val: boolean) => void) { }

  onAdd(map: any) {
    this.map = map;
    this.container = document.createElement('div');
    this.container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
    const btn = document.createElement('button');
    btn.className = 'mapboxgl-ctrl-icon mapboxgl-ctrl-terrain';
    btn.type = 'button';
    btn.title = 'Toggle 3D Terrain';
    btn.style.display = 'block';

    this.icon = document.createElement('span');
    this.icon.className = 'material-symbols-rounded';
    this.icon.style.fontSize = '20px';
    this.icon.style.lineHeight = '29px';
    this.icon.innerText = 'landscape';

    // Set initial state
    if (this.is3D) {
      this.icon.style.color = '#4264fb';
    }

    btn.appendChild(this.icon);

    btn.onclick = () => {
      const was3D = !!map.getTerrain();
      const isNow3D = !was3D;
      this.onToggle(isNow3D);
    };

    this.container.appendChild(btn);
    return this.container;
  }

  onRemove() {
    this.container?.parentNode?.removeChild(this.container);
    this.map = undefined;
  }

  public set3DState(is3D: boolean) {
    this.is3D = is3D;
    if (this.icon) {
      this.icon.style.color = is3D ? '#4264fb' : '';
    }
  }


}
