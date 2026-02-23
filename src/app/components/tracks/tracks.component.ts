import { Component, ViewChild, ElementRef, ChangeDetectorRef, NgZone, effect, signal, WritableSignal, computed, PLATFORM_ID, OnInit, OnDestroy, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { AppEventService } from '../../services/app.event.service';
import { take, debounceTime, filter } from 'rxjs/operators';
import { AppUserInterface } from '../../models/app-user.interface';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { Subject, Subscription, firstValueFrom } from 'rxjs';
import { DateRanges, ActivityTypes, DataPaceAvg, DataSpeedAvg, DataSwimPaceAvg } from '@sports-alliance/sports-lib';
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
import { AppMapSettingsInterface, AppMyTracksSettings } from '../../models/app-user.interface';
import { LoggerService } from '../../services/logger.service';
import { TrackStartPoint, TrackStartSelection, TracksMapManager } from './tracks-map.manager'; // Imported Manager
import { MapStyleService } from '../../services/map-style.service';
import { MapboxStyleSynchronizer } from '../../services/map/mapbox-style-synchronizer';
import { MapStyleName } from '../../services/map/map-style.types';
import { MapboxHeatmapLayerService } from '../../services/map/mapbox-heatmap-layer.service';
import { JumpHeatmapWeightingService } from '../../services/map/jump-heatmap-weighting.service';
import { MapboxStartPointLayerService } from '../../services/map/mapbox-start-point-layer.service';
import { MapboxAutoResizeService } from '../../services/map/mapbox-auto-resize.service';
import { Search } from '../event-search/event-search.component';
import { MyTracksTripDetectionService } from '../../services/my-tracks-trip-detection.service';
import { TripDetectionInput } from '../../services/my-tracks-trip-detection.service';
import { DetectedTrip } from '../../services/my-tracks-trip-detection.service';
import { TripLocationLabelService } from '../../services/trip-location-label.service';
import {
  PolylineSimplificationOptions,
  PolylineSimplificationService
} from '../../services/polyline-simplification.service';
import { resolvePrimaryUnitAwareDisplayStat } from '../../helpers/summary-display.helper';
import {
  resolvePreferredSpeedDerivedAverageTypeForActivity,
  resolvePreferredSpeedDerivedAverageTypesForActivity
} from '../../helpers/summary-stats.helper';
import {
  MapEventPopupContent,
  MapEventPopupContentService
} from '../../services/map/map-event-popup-content.service';
import {
  correctPopupPositionToViewport,
  resolvePopupAnchorPosition,
} from '../../services/map/mapbox-popup-positioning.utils';

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

interface PreparedTrackPolyline {
  activity: any;
  coordinates: number[][];
}

@Component({
  selector: 'app-tracks',
  templateUrl: './tracks.component.html',
  styleUrls: ['./tracks.component.scss'],
  standalone: false
})
export class TracksComponent implements OnInit, OnDestroy {
  private static readonly MY_TRACKS_METADATA_CACHE_TTL_MS = 60 * 60 * 1000;
  private static readonly START_POINT_POPUP_MARGIN_PX = 10;
  private static readonly START_POINT_POPUP_OFFSET_PX = 10;
  private static readonly START_POINT_POPUP_WIDTH_ESTIMATE_PX = 340;
  private static readonly START_POINT_POPUP_HEIGHT_ESTIMATE_PX = 240;
  private static readonly MY_TRACKS_SIMPLIFICATION_OPTIONS: Readonly<PolylineSimplificationOptions> = Object.freeze({
    keepRatio: 0.35,
    minInputPoints: 160,
    minPointsToKeep: 80,
  });

  @ViewChild('mapDiv', { static: true }) mapDiv!: ElementRef;
  @ViewChild('trackStartPopupAnchor', { static: false }) trackStartPopupAnchor?: ElementRef<HTMLDivElement>;

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
  private eventsById = new Map<string, any>();

  private eventsSubscription: Subscription = new Subscription();

  private mapSynchronizer = signal<MapboxStyleSynchronizer | undefined>(undefined);
  private platformId!: object;
  private startPointPopupRepositionHandler: (() => void) | null = null;
  private pendingStartPointPopupCorrectionRaf: number | null = null;

  private promiseTime = 0;
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
  public searchPeekExpanded: WritableSignal<boolean> = signal(true);
  public hasDetectedJumps: WritableSignal<boolean> = signal(false);
  public selectedStartPoint: WritableSignal<TrackStartSelection | null> = signal(null);
  public selectedStartPointScreen: WritableSignal<{ x: number; y: number } | null> = signal(null);
  // Removed legacy state tracking

  public get mapStyleOptions() {
    return this.mapStyleService.getSupportedStyleOptions();
  }

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
    private mapboxLoader: MapboxLoaderService,
    private themeService: AppThemeService,
    private mapStyleService: MapStyleService,
    private mapboxHeatmapLayerService: MapboxHeatmapLayerService,
    private jumpHeatmapWeightingService: JumpHeatmapWeightingService,
    private mapboxStartPointLayerService: MapboxStartPointLayerService,
    private mapboxAutoResizeService: MapboxAutoResizeService,
    private polylineSimplificationService: PolylineSimplificationService,
    private popupContentService: MapEventPopupContentService,
  ) {
    this.tracksMapManager = new TracksMapManager(
      this.zone,
      this.eventColorService,
      this.mapStyleService,
      this.mapboxHeatmapLayerService,
      this.jumpHeatmapWeightingService,
      this.mapboxStartPointLayerService,
      this.logger
    );
    this.tracksMapManager.setIsDarkTheme(this.themeService.appTheme() === AppThemes.Dark);

    const platformId = inject(PLATFORM_ID);
    this.platformId = platformId;
    this.searchPeekDefaultExpanded.set(this.resolveDesktopViewportDefault());
    this.searchPeekExpanded.set(this.searchPeekDefaultExpanded());

    // Track last settings to prevent redundant data fetching
    let lastLoadedDataSettings: { dateRange: DateRanges, activityTypes?: ActivityTypes[] } | null = null;
    let isFirstRun = true;

    // Unified Reactive State: Combines Settings and Theme
    const viewState = computed(() => {
      const myTracksSettings = this.userSettingsQuery.myTracksSettings() as AppMyTracksSettings;
      const mapSettings = this.userSettingsQuery.mapSettings() as AppMapSettingsInterface;
      const theme = this.themeService.appTheme();
      return { myTracksSettings, mapSettings, theme };
    });

    // Single Effect to drive Map State
    effect(() => {
      const { myTracksSettings, mapSettings, theme } = viewState();
      const map = this.mapSignal();
      const user = this.userSignal();
      const synchronizer = this.mapSynchronizer();

      if (!map || !synchronizer || !myTracksSettings || !user) return;

      // 1. Update Map Style via Synchronizer
      const mapStyle = this.mapStyleService.normalizeStyle(mapSettings?.mapStyle);
      this.tracksMapManager.setMapStyle(mapStyle as MapStyleName);
      const resolved = this.mapStyleService.resolve(mapStyle, theme);
      synchronizer.update(resolved);

      // 2. Update Tracks Colors (Theme based)
      this.tracksMapManager.setIsDarkTheme(theme === AppThemes.Dark);
      this.tracksMapManager.refreshTrackColors();
      this.tracksMapManager.setJumpHeatmapVisible(myTracksSettings.showJumpHeatmap !== false);

      // 3. Terrain (is3D)
      this.tracksMapManager.toggleTerrain(!!mapSettings?.is3D, !isFirstRun);
      isFirstRun = false;

      // 4. Data Loading
      // Check if data-impacting settings changed
      const currentSnapshot = { dateRange: myTracksSettings.dateRange, activityTypes: myTracksSettings.activityTypes };

      const dataChanged = !lastLoadedDataSettings ||
        lastLoadedDataSettings.dateRange !== currentSnapshot.dateRange ||
        JSON.stringify(lastLoadedDataSettings.activityTypes) !== JSON.stringify(currentSnapshot.activityTypes);

      if (dataChanged) {
        lastLoadedDataSettings = currentSnapshot;
        this.isLoading.set(true);
        this.loadTracksMapForUserByDateRange(user, myTracksSettings.dateRange, myTracksSettings.activityTypes)
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
      const initialMapSettings = this.userSettingsQuery.mapSettings() as AppMapSettingsInterface;
      const prefMapStyle = this.mapStyleService.normalizeStyle(initialMapSettings?.mapStyle);
      const initialTheme = this.themeService.appTheme();
      const resolved = this.mapStyleService.resolve(prefMapStyle, initialTheme);
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
        this.tracksMapManager.setStartMarkerSelectionHandler((selection) => {
          this.zone.run(() => {
            if (!selection) {
              this.closeSelectedStartPointPopup();
              return;
            }
            this.searchPeekExpanded.set(false);
            this.detectedTripsPanelExpanded.set(false);
            this.selectedStartPoint.set(selection);
            this.updateSelectedStartPointScreenPosition();
            this.centerMapOnStartPoint(selection);
          });
        });
        this.bindStartPointPopupMapListeners(mapInstance);
        this.mapboxAutoResizeService.bind(mapInstance, {
          container: this.mapDiv?.nativeElement,
          onResize: () => {
            if (!this.selectedStartPoint()) return;
            this.zone.run(() => this.updateSelectedStartPointScreenPosition());
          }
        });

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

      });

    } catch (error) {
      this.logger.error('Failed to initialize Mapbox:', error);
    }
  }

  public setMapStyle(styleType: MapStyleName) {
    const normalized = this.mapStyleService.normalizeStyle(styleType);
    // Just update settings. The effect handles the rest.
    this.userSettingsQuery.updateMapSettings({ mapStyle: normalized });
    this.logger.info('[TracksComponent] User selected map style', { styleType: normalized });
  }

  public onMyTracks3DToggle(is3D: boolean): void {
    this.tracksMapManager.toggleTerrain(is3D, true);
    this.userSettingsQuery.updateMapSettings({ is3D });
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

    this.analyticsService.logEvent('my_tracks_search', { method: DateRanges[event.dateRange] });
  }

  public ngOnDestroy() {
    this.unsubscribeFromAll()
    this.bottomSheet.dismiss();
    this.tracksMapManager.setStartMarkerSelectionHandler(null);
    this.unbindStartPointPopupMapListeners();
    if (this.pendingStartPointPopupCorrectionRaf !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.pendingStartPointPopupCorrectionRaf);
      this.pendingStartPointPopupCorrectionRaf = null;
    }
    this.mapboxAutoResizeService.unbind(this.tracksMapManager.getMap());
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

  private isCurrentLoad(promiseTime: number): boolean {
    return this.promiseTime === promiseTime;
  }

  private async getEventsForTracksLoad(
    user: AppUserInterface,
    where: { fieldPath: string | any, opStr: WhereFilterOp, value: any }[],
    promiseTime: number
  ): Promise<any[]> {
    const eventServiceWithOnce = this.eventService as any;
    if (typeof eventServiceWithOnce.getEventsOnceBy === 'function') {
      const events = await firstValueFrom(
        this.eventService.getEventsOnceBy(user, where, 'startDate', true, 0, { preferCache: false })
      );
      this.logger.log(`[TracksComponent] eventService.getEventsOnceBy returned ${events?.length || 0} events for promiseTime: ${promiseTime}`);
      return events || [];
    }

    this.logger.warn('[TracksComponent] getEventsOnceBy is unavailable. Falling back to getEventsBy with take(1).');
    const events = await firstValueFrom(
      this.eventService.getEventsBy(user, where, 'startDate', true, 0).pipe(
        debounceTime(300),
        take(1),
      )
    );
    this.logger.log(`[TracksComponent] eventService.getEventsBy fallback emitted ${events?.length || 0} events for promiseTime: ${promiseTime}`);
    return events || [];
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
    const promiseTime = ++this.promiseTime;
    this.hasEvaluatedTripDetection.set(false);
    this.detectedTrips.set([]);
    this.detectedTripsPanelExpanded.set(false);
    this.hasDetectedJumps.set(false);
    this.trackCoordinatesByEventId = new Map<string, number[][]>();
    this.eventsById = new Map<string, any>();
    this.closeSelectedStartPointPopup();
    this.tracksMapManager.clearAllTracks();
    this.tracksMapManager.clearJumpHeatmap();
    this.clearProgressAndOpenBottomSheet();
    const dates = getDatesForDateRange(dateRange, user.settings?.unitSettings?.startOfTheWeek || 1);
    const where: { fieldPath: string | any, opStr: WhereFilterOp, value: any }[] = [];
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

    try {
      let events = await this.getEventsForTracksLoad(user, where, promiseTime);

      if (!this.isCurrentLoad(promiseTime)) {
        return;
      }

      events = (events || []).filter((event) => !event.isMerge).filter((event) => event.getStat(DataStartPosition.type));
      if (!events || !events.length) {
        if (!this.isCurrentLoad(promiseTime)) {
          return;
        }
        this.tracksMapManager.clearAllTracks();
        this.hasDetectedJumps.set(false);
        this.hasEvaluatedTripDetection.set(true);
        return;
      }

      const chunkedEvents: any[][] = events.reduce((all: any[][], one: any, i: number) => {
        const ch = Math.floor(i / 15);
        all[ch] = ([] as any[]).concat((all[ch] || []), one);
        return all
      }, [])

      this.updateBufferProgress(100);

      if (!this.isCurrentLoad(promiseTime)) {
        return;
      }
      let count = 0;
      let addedTrackCount = 0;
      const allCoordinates: number[][] = [];
      const jumpHeatPoints: JumpHeatPoint[] = [];
      const trackStartPoints: TrackStartPoint[] = [];
      const preparedTracks: PreparedTrackPolyline[] = [];
      const stagedTrackCoordinatesByEventId = new Map<string, number[][]>();
      const stagedEventsById = new Map<string, any>();
      let jumpsWithCoordinates = 0;
      let jumpsWithWeightMetrics = 0;
      let tracksProcessed = 0;
      let tracksSimplified = 0;
      let inputPointsTotal = 0;
      let outputPointsTotal = 0;
      const detectionCandidatesByEvent = new Map<string, TripDetectionInput>();

      for (const eventsChunk of chunkedEvents) {
        if (!this.isCurrentLoad(promiseTime)) {
          return;
        }

        await Promise.all(eventsChunk.map(async (event: any) => {
          if (!this.isCurrentLoad(promiseTime)) {
            return;
          }

          this.logger.log(`[TracksComponent] Fetching activities for event: ${event.getID()}, promiseTime: ${promiseTime}`);
          event.addActivities(await firstValueFrom(this.eventService.getActivities(user, event.getID()).pipe(take(1))));
          let fullEvent = event;
          try {
            // Hydrate lat/long streams from original files without replacing activity objects.
            const hydratedEvent = await firstValueFrom(this.eventService.attachStreamsToEventWithActivities(
              user,
              event,
              [
                DataLatitudeDegrees.type,
                DataLongitudeDegrees.type,
              ],
              true,
              false,
              'attach_streams_only',
              { metadataCacheTtlMs: TracksComponent.MY_TRACKS_METADATA_CACHE_TTL_MS },
            ).pipe(take(1)));
            fullEvent = hydratedEvent || event;
          } catch (error) {
            this.logger.warn('[TracksComponent] Failed to hydrate activity streams from original files. Falling back to existing activities.', {
              eventId: event.getID?.(),
              error
            });
          }
          this.logger.log(`[TracksComponent] Activities and streams ready for event: ${event.getID()}, promiseTime: ${promiseTime}`);
          if (!this.isCurrentLoad(promiseTime)) {
            return;
          }

          const eventId = fullEvent?.getID?.() || event.getID();
          if (eventId) {
            stagedEventsById.set(eventId, fullEvent || event);
          }
          let hasVisibleTrackForEvent = false;
          const eventCoordinates: number[][] = [];
          const activities = typeof fullEvent?.getActivities === 'function' ? fullEvent.getActivities() : [];
          activities
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
                const simplificationResult = this.polylineSimplificationService.simplifyVisvalingamWhyatt(
                  coordinates,
                  TracksComponent.MY_TRACKS_SIMPLIFICATION_OPTIONS
                );
                const simplifiedCoordinates = simplificationResult.coordinates;
                tracksProcessed++;
                inputPointsTotal += simplificationResult.inputPointCount;
                outputPointsTotal += simplificationResult.outputPointCount;
                if (simplificationResult.simplified) {
                  tracksSimplified++;
                }

                const startPoint = this.buildTrackStartPoint(
                  activity,
                  eventId,
                  simplifiedCoordinates[0],
                  fullEvent?.startDate ?? event?.startDate
                );
                if (startPoint) {
                  trackStartPoints.push(startPoint);
                }
                preparedTracks.push({ activity, coordinates: simplifiedCoordinates });
                addedTrackCount++;
                hasVisibleTrackForEvent = true;
                simplifiedCoordinates.forEach((coordinate: number[]) => {
                  allCoordinates.push(coordinate);
                  eventCoordinates.push(coordinate);
                });
              }
            });

          if (hasVisibleTrackForEvent && eventId) {
            stagedTrackCoordinatesByEventId.set(eventId, eventCoordinates);
            const detectionInput = this.getTripDetectionInputFromEvent(fullEvent || event);
            if (detectionInput) {
              detectionCandidatesByEvent.set(detectionInput.eventId, detectionInput);
            }
          }

          count++;
          this.updateTotalProgress(Math.ceil((count / events.length) * 100));
        }));
      }

      // Ensure canceled/stale loads never commit map/UI state after a newer request started.
      if (!this.isCurrentLoad(promiseTime)) {
        this.logger.log('[TracksComponent] Skipping stale tracks load commit.', {
          promiseTime,
          currentPromiseTime: this.promiseTime,
        });
        return;
      }

      this.trackCoordinatesByEventId = stagedTrackCoordinatesByEventId;
      this.eventsById = stagedEventsById;

      this.tracksMapManager.clearAllTracks();
      if (addedTrackCount > 0) {
        preparedTracks.forEach((track) => this.tracksMapManager.addTrackFromActivity(track.activity, track.coordinates));
        if (trackStartPoints.length > 0) {
          this.tracksMapManager.setActivityStartPoints(trackStartPoints);
          await this.waitForStartPointLayerReady();
        } else {
          this.tracksMapManager.clearActivityStartPoints();
        }
      }

      if (allCoordinates.length > 0) {
        await this.waitForMapRenderTick();
        this.fitBoundsToTracks(allCoordinates);
      }
      if (jumpHeatPoints.length > 0) {
        this.hasDetectedJumps.set(true);
        this.tracksMapManager.setJumpHeatPoints(jumpHeatPoints);
      } else {
        this.hasDetectedJumps.set(false);
        this.tracksMapManager.clearJumpHeatmap();
      }
      const reductionPercent = inputPointsTotal > 0
        ? Math.round((1 - (outputPointsTotal / inputPointsTotal)) * 1000) / 10
        : 0;
      this.logger.log('[TracksComponent] Track polyline simplification summary.', {
        tracksProcessed,
        tracksSimplified,
        inputPointsTotal,
        outputPointsTotal,
        reductionPercent,
        promiseTime
      });
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
      if (this.isCurrentLoad(promiseTime)) {
        this.clearProgressAndCloseBottomSheet();
      }
    }
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

  public closeSelectedStartPointPopup(): void {
    this.tracksMapManager.clearStartPointSelection();
    this.selectedStartPoint.set(null);
    this.selectedStartPointScreen.set(null);
  }

  public openSelectedStartPointEvent(): void {
    const selected = this.selectedStartPoint();
    const userId = this.user?.uid;
    if (!selected?.eventId || !userId) {
      this.logger.warn('[TracksComponent] Unable to open selected start-point event.', {
        hasEventId: !!selected?.eventId,
        hasUserId: !!userId
      });
      return;
    }

    this.router.navigate(['/user', userId, 'event', selected.eventId]);
    this.closeSelectedStartPointPopup();
  }

  public resolveStartPointEvent(startPoint: TrackStartSelection | null): any | null {
    if (!startPoint?.eventId) return null;
    return this.eventsById.get(startPoint.eventId) || null;
  }

  public getStartPointPopupContent(startPoint: TrackStartSelection | null): MapEventPopupContent | null {
    const event = this.resolveStartPointEvent(startPoint);
    if (!event) {
      return null;
    }
    return this.popupContentService.buildFromEvent(event);
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

  private buildTrackStartPoint(
    activity: any,
    eventId: string,
    startCoordinate: number[],
    startDateInput: number | Date | null | undefined
  ): TrackStartPoint | null {
    if (!Array.isArray(startCoordinate) || startCoordinate.length < 2) return null;
    const lng = Number(startCoordinate[0]);
    const lat = Number(startCoordinate[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;

    const activityId = activity?.getID?.();
    if (!eventId || !activityId) return null;

    let startDate: number | null = null;
    if (typeof startDateInput === 'number' && Number.isFinite(startDateInput)) {
      startDate = startDateInput;
    } else if (startDateInput instanceof Date && Number.isFinite(startDateInput.getTime())) {
      startDate = startDateInput.getTime();
    }

    return {
      eventId: String(eventId),
      activityId: String(activityId),
      activityType: this.resolveActivityTypeLabel(activity),
      activityTypeValue: activity?.type ?? null,
      durationValue: this.getNumericActivityStatValue(activity?.getDuration?.()),
      distanceValue: this.getNumericActivityStatValue(activity?.getDistance?.()),
      startDate,
      durationLabel: this.formatActivityDurationLabel(activity),
      distanceLabel: this.formatActivityDistanceLabel(activity),
      ...this.resolveActivityEffortMetric(activity),
      lng,
      lat
    };
  }

  private resolveActivityTypeLabel(activity: any): string {
    const rawType = activity?.type;
    if (typeof rawType === 'string' && rawType.length > 0) return rawType;
    if (typeof rawType === 'number' && ActivityTypes[rawType]) return String(ActivityTypes[rawType]);
    return 'Activity';
  }

  private formatActivityDurationLabel(activity: any): string {
    const durationStat = activity?.getDuration?.();
    if (!durationStat?.getDisplayValue) return '-';
    try {
      const value = durationStat.getDisplayValue(false, false);
      if (value === undefined || value === null || value === '') return '-';
      return String(value);
    } catch {
      try {
        const value = durationStat.getDisplayValue();
        if (value === undefined || value === null || value === '') return '-';
        return String(value);
      } catch {
        return '-';
      }
    }
  }

  private formatActivityDistanceLabel(activity: any): string {
    const distanceStat = activity?.getDistance?.();
    if (!distanceStat?.getDisplayValue) return '-';
    const value = distanceStat.getDisplayValue();
    const unit = distanceStat.getDisplayUnit?.();
    if (value === undefined || value === null || value === '') return '-';
    return `${value}${unit ? ` ${unit}` : ''}`.trim();
  }

  private getNumericActivityStatValue(stat: any): number | null {
    const value = stat?.getValue?.();
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
    return null;
  }

  private resolveActivityEffortMetric(activity: any): Pick<TrackStartPoint, 'effortLabel' | 'effortDisplayLabel' | 'effortStatType'> {
    const preferredType = resolvePreferredSpeedDerivedAverageTypeForActivity(activity?.type);
    const candidateTypes = [
      preferredType,
      ...resolvePreferredSpeedDerivedAverageTypesForActivity(activity?.type),
      DataSpeedAvg.type,
      DataPaceAvg.type,
      DataSwimPaceAvg.type,
    ].filter((type): type is string => typeof type === 'string' && type.length > 0);

    const orderedTypes = [...new Set(candidateTypes).values()];
    const unitSettings = typeof this.userSettingsQuery.unitSettings === 'function'
      ? this.userSettingsQuery.unitSettings()
      : undefined;

    for (const statType of orderedTypes) {
      const stat = activity?.getStat?.(statType);
      const display = resolvePrimaryUnitAwareDisplayStat(stat, unitSettings, statType);
      if (!display || !display.value) {
        continue;
      }
      return {
        effortLabel: this.isPaceDerivedStatType(statType) ? 'Pace' : 'Speed',
        effortDisplayLabel: `${display.value}${display.unit ? ` ${display.unit}` : ''}`.trim(),
        effortStatType: display.type || statType,
      };
    }

    const fallbackType = preferredType || DataSpeedAvg.type;
    return {
      effortLabel: this.isPaceDerivedStatType(fallbackType) ? 'Pace' : 'Speed',
      effortDisplayLabel: '-',
      effortStatType: fallbackType,
    };
  }

  private isPaceDerivedStatType(statType: string | null | undefined): boolean {
    return typeof statType === 'string' && statType.toLowerCase().includes('pace');
  }

  private bindStartPointPopupMapListeners(map: any): void {
    this.unbindStartPointPopupMapListeners();
    if (!map?.on) return;
    this.startPointPopupRepositionHandler = () => {
      if (!this.selectedStartPoint()) return;
      this.zone.run(() => this.updateSelectedStartPointScreenPosition());
    };

    ['move', 'zoom', 'rotate', 'pitch', 'resize'].forEach((eventName) => {
      map.on(eventName, this.startPointPopupRepositionHandler);
    });
  }

  private unbindStartPointPopupMapListeners(): void {
    if (!this.startPointPopupRepositionHandler) return;
    const map = this.tracksMapManager.getMap();
    if (map?.off) {
      ['move', 'zoom', 'rotate', 'pitch', 'resize'].forEach((eventName) => {
        map.off(eventName, this.startPointPopupRepositionHandler);
      });
    }
    this.startPointPopupRepositionHandler = null;
  }

  private updateSelectedStartPointScreenPosition(): void {
    const selected = this.selectedStartPoint();
    const map = this.tracksMapManager.getMap();
    if (!selected || !map?.project) {
      this.selectedStartPointScreen.set(null);
      return;
    }

    const projected = map.project([selected.lng, selected.lat]);
    const x = Math.round(Number(projected?.x));
    const y = Math.round(Number(projected?.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      this.selectedStartPointScreen.set(null);
      return;
    }
    const position = resolvePopupAnchorPosition({ x, y }, this.mapDiv?.nativeElement, {
      preferredWidthPx: TracksComponent.START_POINT_POPUP_WIDTH_ESTIMATE_PX,
      preferredHeightPx: TracksComponent.START_POINT_POPUP_HEIGHT_ESTIMATE_PX,
      marginPx: TracksComponent.START_POINT_POPUP_MARGIN_PX,
      offsetPx: TracksComponent.START_POINT_POPUP_OFFSET_PX,
      minWidthPx: 170,
      minHeightPx: 120,
      preferAbove: true,
    });
    if (!position) {
      this.selectedStartPointScreen.set(null);
      return;
    }
    this.selectedStartPointScreen.set(position);
    this.scheduleStartPointPopupViewportCorrection();
  }

  private scheduleStartPointPopupViewportCorrection(): void {
    if (this.pendingStartPointPopupCorrectionRaf !== null || typeof requestAnimationFrame !== 'function') {
      return;
    }

    this.pendingStartPointPopupCorrectionRaf = requestAnimationFrame(() => {
      this.pendingStartPointPopupCorrectionRaf = null;
      this.correctStartPointPopupPositionWithMeasuredSize();
    });
  }

  private correctStartPointPopupPositionWithMeasuredSize(): void {
    const current = this.selectedStartPointScreen();
    const mapElement = this.mapDiv?.nativeElement;
    const popupElement = this.trackStartPopupAnchor?.nativeElement;
    if (!this.selectedStartPoint() || !current || !mapElement || !popupElement) {
      return;
    }

    const corrected = correctPopupPositionToViewport(
      current,
      mapElement,
      popupElement,
      TracksComponent.START_POINT_POPUP_MARGIN_PX
    );
    if (corrected) {
      this.selectedStartPointScreen.set(corrected);
    }
  }

  private centerMapOnStartPoint(selection: TrackStartSelection): void {
    if (!selection) return;
    const map = this.tracksMapManager.getMap();
    if (!map?.easeTo) return;
    const target: [number, number] = [selection.lng, selection.lat];
    const MIN_ZOOM_ON_SELECT = 11;
    const currentZoom = typeof map.getZoom === 'function' ? map.getZoom() : 0;
    const targetZoom = Math.max(currentZoom, MIN_ZOOM_ON_SELECT);
    this.zone.runOutsideAngular(() => {
      try {
        map.easeTo({
          center: target,
          zoom: targetZoom,
          animate: true,
          duration: 480,
          essential: true
        });
      } catch (error) {
        this.logger.warn('[TracksComponent] Failed to pan/zoom map to selected start point.', {
          selection,
          error
        });
      }
    });
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

  private waitForMapRenderTick(): Promise<void> {
    const map = this.tracksMapManager.getMap();
    if (!map?.once) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      try {
        map.once('render', done);
      } catch {
        done();
        return;
      }

      setTimeout(done, 40);
    });
  }

  private waitForStartPointLayerReady(timeoutMs: number = 240): Promise<void> {
    const map = this.tracksMapManager.getMap();
    const layerId = 'track-start-layer';
    if (!map?.getLayer) {
      return Promise.resolve();
    }
    if (map.getLayer(layerId)) {
      return this.waitForMapRenderTick();
    }

    return new Promise<void>((resolve) => {
      let settled = false;
      const cleanup = () => {
        if (!map?.off) return;
        map.off('styledata', checkReady);
        map.off('render', checkReady);
        map.off('idle', checkReady);
      };
      const done = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const checkReady = () => {
        if (map.getLayer?.(layerId)) {
          done();
        }
      };

      if (map?.on) {
        map.on('styledata', checkReady);
        map.on('render', checkReady);
        map.on('idle', checkReady);
      }
      checkReady();
      setTimeout(done, timeoutMs);
    });
  }
}
