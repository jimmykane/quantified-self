import { Component, ViewChild, ElementRef, ChangeDetectorRef, NgZone, effect, signal, WritableSignal, computed, PLATFORM_ID, OnInit, OnDestroy, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { AppEventService } from '../../services/app.event.service';
import { take, filter } from 'rxjs/operators';
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
import { TrackStartPoint, TrackStartSelection, TracksMapManager, TripAreaOverlay } from './tracks-map.manager'; // Imported Manager
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
import { DetectedHomeArea } from '../../services/my-tracks-trip-detection.service';
import {
  ResolvedTripLocationLabel,
  TripLocationCoordinateCandidate,
  TripLocationLabelService
} from '../../services/trip-location-label.service';
import {
  PolylineSimplificationOptions,
  PolylineSimplificationService
} from '../../services/polyline-simplification.service';
import {
  CachedMyTracksEventPolylines,
  MyTracksPolylineCacheService,
  ResolvedMyTracksActivityPolyline
} from '../../services/my-tracks-polyline-cache.service';
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
  private static readonly TRIP_HOME_INFERENCE_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;
  private static readonly HOME_PANEL_ENTRY_ID = '__home_panel_entry__';
  private static readonly START_POINT_POPUP_MARGIN_PX = 10;
  private static readonly START_POINT_POPUP_OFFSET_PX = 10;
  private static readonly START_POINT_POPUP_WIDTH_ESTIMATE_PX = 340;
  private static readonly START_POINT_POPUP_HEIGHT_ESTIMATE_PX = 240;
  private static readonly MY_TRACKS_SIMPLIFICATION_MIN_KEEP_RATIO = 0.08;
  private static readonly MY_TRACKS_SIMPLIFICATION_MAX_POINTS_PER_TRACK = 900;
  private static readonly MY_TRACKS_SIMPLIFICATION_OPTIONS: Readonly<PolylineSimplificationOptions> = Object.freeze({
    keepRatio: 0.25,
    minInputPoints: 120,
    minPointsToKeep: 60,
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
  private panPerformanceModeStartHandler: (() => void) | null = null;
  private panPerformanceModeEndHandler: (() => void) | null = null;
  private panPerformanceModeResetTimer: ReturnType<typeof setTimeout> | null = null;

  private promiseTime = 0;
  private analyticsService = inject(AppAnalyticsService);
  private userSettingsQuery = inject(AppUserSettingsQueryService);
  private logger = inject(LoggerService);
  private tripDetectionService = inject(MyTracksTripDetectionService);
  private tripLocationLabelService = inject(TripLocationLabelService);
  private myTracksPolylineCacheService = inject(MyTracksPolylineCacheService);

  public isLoading: WritableSignal<boolean> = signal(false);
  public detectedTrips: WritableSignal<DetectedTripViewModel[]> = signal([]);
  public detectedHomeArea: WritableSignal<DetectedHomeArea | null> = signal(null);
  public hasEvaluatedTripDetection: WritableSignal<boolean> = signal(false);
  public detectedTripsPanelExpanded: WritableSignal<boolean> = signal(false);
  public selectedDetectedTripId: WritableSignal<string | null> = signal(null);
  public hoveredDetectedTripId: WritableSignal<string | null> = signal(null);
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
        this.bindPanPerformanceModeListeners(mapInstance);
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
    this.unbindPanPerformanceModeListeners();
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
    const events = await firstValueFrom(
      this.eventService.getEventsOnceBy(user, where, 'startDate', true, 0, { preferCache: false })
    );
    this.logger.log(`[TracksComponent] eventService.getEventsOnceBy returned ${events?.length || 0} events for promiseTime: ${promiseTime}`);
    return events || [];
  }

  private async getEventsForHomeInference(
    user: AppUserInterface,
    where: { fieldPath: string | any, opStr: WhereFilterOp, value: any }[],
    promiseTime: number
  ): Promise<any[]> {
    const events = await firstValueFrom(
      this.eventService.getEventsOnceBy(user, where, 'startDate', true, 0, { preferCache: false })
    );
    this.logger.log(`[TracksComponent] Home inference event query returned ${events?.length || 0} events for promiseTime: ${promiseTime}`);
    return events || [];
  }

  private async loadTracksMapForUserByDateRange(user: AppUserInterface | undefined, dateRange: DateRanges, activityTypes?: ActivityTypes[]) {
    if (!user) {
      this.logger.warn('[TracksComponent] Skipping track load because user is undefined.');
      return;
    }
    const loadStartedAt = performance.now();
    const roundMs = (value: number): number => Number(value.toFixed(2));
    let eventsFetchDurationMs = 0;
    let activitiesFetchDurationMs = 0;
    let streamsHydrationDurationMs = 0;
    let coordinateExtractionDurationMs = 0;
    let simplificationDurationMs = 0;
    let mapCommitDurationMs = 0;
    let tripDetectionDurationMs = 0;
    let polylineCacheHitCount = 0;
    let polylineCacheMissCount = 0;
    const perEventPerformance: Array<{
      eventId: string;
      totalMs: number;
      activitiesFetchMs: number;
      hydrationMs: number;
      coordinateExtractionMs: number;
      simplificationMs: number;
      activityCount: number;
      visibleTrackCount: number;
      inputPoints: number;
      outputPoints: number;
    }> = [];

    this.logger.log('[TracksComponent] Starting track load for trip detection.', {
      dateRange: DateRanges[dateRange],
      activityTypes: activityTypes || [],
      userId: (user as any).uid || (user as any).id || 'unknown'
    });
    this.hasTrackBoundsBeenApplied = true;
    const promiseTime = ++this.promiseTime;
    this.hasEvaluatedTripDetection.set(false);
    this.detectedTrips.set([]);
    this.detectedHomeArea.set(null);
    this.detectedTripsPanelExpanded.set(false);
    this.selectedDetectedTripId.set(null);
    this.hoveredDetectedTripId.set(null);
    this.hasDetectedJumps.set(false);
    this.trackCoordinatesByEventId = new Map<string, number[][]>();
    this.eventsById = new Map<string, any>();
    this.closeSelectedStartPointPopup();
    this.tracksMapManager.clearAllTracks();
    this.tracksMapManager.clearJumpHeatmap();
    this.clearProgressAndOpenBottomSheet();
    const dates = getDatesForDateRange(dateRange, user.settings?.unitSettings?.startOfTheWeek || 1);
    const where = this.buildStartDateWhereClauses(
      dates.startDate?.getTime() ?? null,
      dates.endDate?.getTime() ?? null,
    );

    this.logger.log(`[TracksComponent] Initializing fetch from event service for dateRange: ${DateRanges[dateRange]}, activityTypes: ${activityTypes?.[0] || 'all'}, promiseTime: ${promiseTime}`);

    try {
      const eventsFetchStartedAt = performance.now();
      let events = await this.getEventsForTracksLoad(user, where, promiseTime);
      eventsFetchDurationMs = performance.now() - eventsFetchStartedAt;

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
        const totalLoadDurationMs = performance.now() - loadStartedAt;
        this.logger.info('[perf] my_tracks_load_pipeline', {
          promiseTime,
          dateRange: DateRanges[dateRange],
          eventCount: 0,
          chunkCount: 0,
          totalLoadDurationMs: roundMs(totalLoadDurationMs),
          eventsFetchDurationMs: roundMs(eventsFetchDurationMs),
          activitiesFetchDurationMs: 0,
          streamsHydrationDurationMs: 0,
          coordinateExtractionDurationMs: 0,
          simplificationDurationMs: 0,
          mapCommitDurationMs: 0,
          tripDetectionDurationMs: 0,
        });
        return;
      }

      const historicalHomeInferenceCandidates = dateRange === DateRanges.all
        ? []
        : await this.getHomeInferenceCandidatesForCurrentLoad(
          user,
          dateRange,
          dates.endDate ?? null,
          events,
          promiseTime,
        );

      if (!this.isCurrentLoad(promiseTime)) {
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

          const eventProcessingStartedAt = performance.now();
          const sourceEventId = event?.getID?.() || 'unknown-event';
          let eventActivitiesFetchDurationMs = 0;
          let eventHydrationDurationMs = 0;
          let eventCoordinateExtractionDurationMs = 0;
          let eventSimplificationDurationMs = 0;
          let eventInputPoints = 0;
          let eventOutputPoints = 0;
          let eventActivityCount = 0;
          let eventVisibleTrackCount = 0;

          this.logger.log(`[TracksComponent] Fetching activities for event: ${event.getID()}, promiseTime: ${promiseTime}`);
          const eventActivitiesFetchStartedAt = performance.now();
          event.addActivities(await firstValueFrom(this.eventService.getActivitiesOnceByEventWithOptions(
            user,
            event.getID(),
            { preferCache: true, warmServer: false },
          )));
          eventActivitiesFetchDurationMs = performance.now() - eventActivitiesFetchStartedAt;
          activitiesFetchDurationMs += eventActivitiesFetchDurationMs;

          const eventHydrationStartedAt = performance.now();
          const resolvedTrackData = await this.resolveTrackDataForEvent(user, event);
          const fullEvent = resolvedTrackData.fullEvent;
          if (resolvedTrackData.usedCache) {
            polylineCacheHitCount += 1;
          } else {
            polylineCacheMissCount += 1;
          }
          eventHydrationDurationMs = performance.now() - eventHydrationStartedAt;
          streamsHydrationDurationMs += eventHydrationDurationMs;
          this.logger.log(`[TracksComponent] Activities and streams ready for event: ${event.getID()}, promiseTime: ${promiseTime}`);
          if (!this.isCurrentLoad(promiseTime)) {
            return;
          }

          const eventId = fullEvent?.getID?.() || sourceEventId;
          if (eventId) {
            stagedEventsById.set(eventId, fullEvent || event);
          }
          let hasVisibleTrackForEvent = false;
          const eventCoordinates: number[][] = [];
          const activities = this.getEventActivities(fullEvent);
          eventActivityCount = activities.length;
          resolvedTrackData.trackPolylines
            .filter(({ activity }) => !activityTypes || activityTypes.length === 0 || activityTypes.includes(activity.type))
            .forEach(({ activity, coordinates }) => {
              const jumpStats = this.collectJumpHeatPointsFromActivity(activity, jumpHeatPoints);
              jumpsWithCoordinates += jumpStats.jumpsWithCoordinates;
              jumpsWithWeightMetrics += jumpStats.jumpsWithWeightMetrics;

              const coordinateExtractionStartedAt = performance.now();
              const normalizedCoordinates = coordinates;
              const coordinateExtractionMs = performance.now() - coordinateExtractionStartedAt;
              coordinateExtractionDurationMs += coordinateExtractionMs;
              eventCoordinateExtractionDurationMs += coordinateExtractionMs;

              if (normalizedCoordinates.length > 1) {
                const simplificationStartedAt = performance.now();
                const simplificationResult = this.polylineSimplificationService.simplifyVisvalingamWhyatt(
                  normalizedCoordinates,
                  this.resolveMyTracksSimplificationOptions(normalizedCoordinates.length, events.length)
                );
                const simplificationMs = performance.now() - simplificationStartedAt;
                simplificationDurationMs += simplificationMs;
                eventSimplificationDurationMs += simplificationMs;
                const simplifiedCoordinates = simplificationResult.coordinates;
                tracksProcessed++;
                inputPointsTotal += simplificationResult.inputPointCount;
                outputPointsTotal += simplificationResult.outputPointCount;
                eventInputPoints += simplificationResult.inputPointCount;
                eventOutputPoints += simplificationResult.outputPointCount;
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
                eventVisibleTrackCount++;
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

          const eventTotalMs = performance.now() - eventProcessingStartedAt;
          perEventPerformance.push({
            eventId,
            totalMs: eventTotalMs,
            activitiesFetchMs: eventActivitiesFetchDurationMs,
            hydrationMs: eventHydrationDurationMs,
            coordinateExtractionMs: eventCoordinateExtractionDurationMs,
            simplificationMs: eventSimplificationDurationMs,
            activityCount: eventActivityCount,
            visibleTrackCount: eventVisibleTrackCount,
            inputPoints: eventInputPoints,
            outputPoints: eventOutputPoints,
          });

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

      const mapCommitStartedAt = performance.now();
      this.trackCoordinatesByEventId = stagedTrackCoordinatesByEventId;
      this.eventsById = stagedEventsById;

      this.tracksMapManager.clearAllTracks();
      if (addedTrackCount > 0) {
        this.tracksMapManager.setTracksFromPrepared(preparedTracks);
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
      mapCommitDurationMs = performance.now() - mapCommitStartedAt;
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
      const homeInferenceCandidates = dateRange === DateRanges.all
        ? Array.from(detectionCandidatesByEvent.values())
        : historicalHomeInferenceCandidates;
      this.logger.log('[TracksComponent] Prepared trip detection candidates.', {
        candidateCount: detectionCandidatesByEvent.size,
        homeInferenceCandidateCount: homeInferenceCandidates.length,
        promiseTime
      });
      const tripDetectionStartedAt = performance.now();
      await this.updateDetectedTripsForCurrentLoad(
        Array.from(detectionCandidatesByEvent.values()),
        homeInferenceCandidates,
        promiseTime,
      );
      tripDetectionDurationMs = performance.now() - tripDetectionStartedAt;

      const totalLoadDurationMs = performance.now() - loadStartedAt;
      const topSlowEvents = perEventPerformance
        .sort((a, b) => b.totalMs - a.totalMs)
        .slice(0, 5)
        .map((eventPerf) => ({
          eventId: eventPerf.eventId,
          totalMs: roundMs(eventPerf.totalMs),
          activitiesFetchMs: roundMs(eventPerf.activitiesFetchMs),
          hydrationMs: roundMs(eventPerf.hydrationMs),
          coordinateExtractionMs: roundMs(eventPerf.coordinateExtractionMs),
          simplificationMs: roundMs(eventPerf.simplificationMs),
          activityCount: eventPerf.activityCount,
          visibleTrackCount: eventPerf.visibleTrackCount,
          inputPoints: eventPerf.inputPoints,
          outputPoints: eventPerf.outputPoints,
        }));
      const avgEventDurationMs = perEventPerformance.length > 0
        ? perEventPerformance.reduce((sum, eventPerf) => sum + eventPerf.totalMs, 0) / perEventPerformance.length
        : 0;
      this.logger.info('[perf] my_tracks_load_pipeline', {
        promiseTime,
        dateRange: DateRanges[dateRange],
        eventCount: events.length,
        chunkCount: chunkedEvents.length,
        tracksProcessed,
        tracksSimplified,
        inputPointsTotal,
        outputPointsTotal,
        reductionPercent,
        totalLoadDurationMs: roundMs(totalLoadDurationMs),
        avgEventDurationMs: roundMs(avgEventDurationMs),
        eventsFetchDurationMs: roundMs(eventsFetchDurationMs),
        activitiesFetchDurationMs: roundMs(activitiesFetchDurationMs),
        streamsHydrationDurationMs: roundMs(streamsHydrationDurationMs),
        coordinateExtractionDurationMs: roundMs(coordinateExtractionDurationMs),
        simplificationDurationMs: roundMs(simplificationDurationMs),
        mapCommitDurationMs: roundMs(mapCommitDurationMs),
        tripDetectionDurationMs: roundMs(tripDetectionDurationMs),
        polylineCacheHitCount,
        polylineCacheMissCount,
        topSlowEvents,
      });
      if (totalLoadDurationMs > 3000) {
        this.logger.warn('[TracksComponent] Slow my-tracks load detected.', {
          promiseTime,
          totalLoadDurationMs: roundMs(totalLoadDurationMs),
          eventCount: events.length,
          tracksProcessed,
          polylineCacheHitCount,
          polylineCacheMissCount,
          topSlowEvents,
        });
      }
    } catch (e) {
      this.logger.error('Error loading tracks', e);
    } finally {
      if (this.isCurrentLoad(promiseTime)) {
        this.clearProgressAndCloseBottomSheet();
      }
    }
  }

  private async resolveTrackDataForEvent(
    user: AppUserInterface,
    event: any,
  ): Promise<{ fullEvent: any; trackPolylines: ResolvedMyTracksActivityPolyline[]; usedCache: boolean }> {
    const cacheOptions = { metadataCacheTtlMs: TracksComponent.MY_TRACKS_METADATA_CACHE_TTL_MS };
    const initialActivities = this.getEventActivities(event);
    const cacheKey = await this.myTracksPolylineCacheService.resolveEventCacheKey(event, cacheOptions);
    const cachedPolylines = cacheKey
      ? await this.myTracksPolylineCacheService.getEventPolylines(cacheKey)
      : undefined;

    if (this.isValidCachedTrackData(initialActivities, cachedPolylines)) {
      return {
        fullEvent: event,
        trackPolylines: this.myTracksPolylineCacheService.resolveTrackPolylines(initialActivities, cachedPolylines),
        usedCache: true,
      };
    }

    const fullEvent = await this.hydrateTrackStreamsForEvent(user, event);
    const resolvedActivities = this.getEventActivities(fullEvent);
    const extractedPolylines = this.myTracksPolylineCacheService.extractTrackPolylines(resolvedActivities);
    if (cacheKey && this.shouldPersistTrackData(fullEvent, event, resolvedActivities)) {
      await this.myTracksPolylineCacheService.setEventPolylines(cacheKey, extractedPolylines);
    }

    return {
      fullEvent,
      trackPolylines: this.myTracksPolylineCacheService.resolveTrackPolylines(resolvedActivities, extractedPolylines),
      usedCache: false,
    };
  }

  private async hydrateTrackStreamsForEvent(user: AppUserInterface, event: any): Promise<any> {
    try {
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
      return hydratedEvent || event;
    } catch (error) {
      this.logger.warn('[TracksComponent] Failed to hydrate activity streams from original files. Falling back to existing activities.', {
        eventId: event.getID?.(),
        error
      });
      return event;
    }
  }

  private getEventActivities(event: any): any[] {
    return typeof event?.getActivities === 'function'
      ? event.getActivities() || []
      : [];
  }

  private isValidCachedTrackData(
    activities: any[],
    cachedPolylines: CachedMyTracksEventPolylines | undefined,
  ): cachedPolylines is CachedMyTracksEventPolylines {
    return this.myTracksPolylineCacheService.hasMatchingActivityIdentity(activities, cachedPolylines);
  }

  private shouldPersistTrackData(fullEvent: any, sourceEvent: any, activities: any[]): boolean {
    if (fullEvent !== sourceEvent) {
      return true;
    }

    return activities.some((activity) => activity?.hasPositionData?.());
  }

  private resolveMyTracksSimplificationOptions(inputPointCount: number, eventCount: number): PolylineSimplificationOptions {
    const baseOptions = TracksComponent.MY_TRACKS_SIMPLIFICATION_OPTIONS;
    const baseKeepRatio = baseOptions.keepRatio ?? 1;
    const baseMinPointsToKeep = baseOptions.minPointsToKeep ?? 2;
    if (!Number.isFinite(inputPointCount) || inputPointCount <= 0) {
      return baseOptions;
    }

    let maxPointsPerTrack = TracksComponent.MY_TRACKS_SIMPLIFICATION_MAX_POINTS_PER_TRACK;
    let effectiveKeepRatio = baseKeepRatio;
    let effectiveMinPointsToKeep = baseMinPointsToKeep;

    // Load-specific profile tightening for very large track sets.
    if (eventCount >= 300) {
      maxPointsPerTrack = 350;
      effectiveKeepRatio = Math.min(effectiveKeepRatio, 0.18);
      effectiveMinPointsToKeep = Math.min(effectiveMinPointsToKeep, 45);
    } else if (eventCount >= 180) {
      maxPointsPerTrack = 500;
      effectiveKeepRatio = Math.min(effectiveKeepRatio, 0.22);
      effectiveMinPointsToKeep = Math.min(effectiveMinPointsToKeep, 55);
    } else if (eventCount >= 120) {
      maxPointsPerTrack = 650;
      effectiveKeepRatio = Math.min(effectiveKeepRatio, 0.24);
      effectiveMinPointsToKeep = Math.min(effectiveMinPointsToKeep, 60);
    }

    const capRatio = maxPointsPerTrack / inputPointCount;
    const adaptiveKeepRatio = Math.max(
      TracksComponent.MY_TRACKS_SIMPLIFICATION_MIN_KEEP_RATIO,
      Math.min(effectiveKeepRatio, capRatio),
    );

    if (adaptiveKeepRatio >= baseKeepRatio && effectiveMinPointsToKeep >= baseMinPointsToKeep) {
      return baseOptions;
    }

    return {
      ...baseOptions,
      keepRatio: adaptiveKeepRatio,
      minPointsToKeep: effectiveMinPointsToKeep,
    };
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
    this.selectedDetectedTripId.set(trip.tripId);
    this.applyActiveDetectedTripAreaOverlay();

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

  public onDetectedHomeSelected(): void {
    const homeArea = this.detectedHomeArea();
    if (!homeArea) {
      return;
    }

    this.selectedDetectedTripId.set(TracksComponent.HOME_PANEL_ENTRY_ID);
    this.applyActiveDetectedTripAreaOverlay();
    this.fitBoundsToTracks([
      [homeArea.bounds.west, homeArea.bounds.south],
      [homeArea.bounds.east, homeArea.bounds.north],
    ]);
  }

  public onDetectedTripHovered(trip: DetectedTripViewModel): void {
    this.hoveredDetectedTripId.set(trip.tripId);
    this.applyActiveDetectedTripAreaOverlay();
  }

  public onDetectedHomeHovered(): void {
    if (!this.detectedHomeArea()) {
      return;
    }

    this.hoveredDetectedTripId.set(TracksComponent.HOME_PANEL_ENTRY_ID);
    this.applyActiveDetectedTripAreaOverlay();
  }

  public onDetectedTripHoverEnded(trip: DetectedTripViewModel): void {
    if (this.hoveredDetectedTripId() !== trip.tripId) {
      return;
    }

    this.hoveredDetectedTripId.set(null);
    this.applyActiveDetectedTripAreaOverlay();
  }

  public onDetectedHomeHoverEnded(): void {
    if (this.hoveredDetectedTripId() !== TracksComponent.HOME_PANEL_ENTRY_ID) {
      return;
    }

    this.hoveredDetectedTripId.set(null);
    this.applyActiveDetectedTripAreaOverlay();
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

  private buildStartDateWhereClauses(
    startTimestamp: number | null,
    endTimestamp: number | null,
  ): { fieldPath: string | any, opStr: WhereFilterOp, value: any }[] {
    const where: { fieldPath: string | any, opStr: WhereFilterOp, value: any }[] = [];

    if (Number.isFinite(startTimestamp)) {
      where.push({
        fieldPath: 'startDate',
        opStr: <WhereFilterOp>'>=',
        value: startTimestamp,
      });
    }

    if (Number.isFinite(endTimestamp)) {
      where.push({
        fieldPath: 'startDate',
        opStr: <WhereFilterOp>'<=',
        value: endTimestamp,
      });
    }

    return where;
  }

  private async getHomeInferenceCandidatesForCurrentLoad(
    user: AppUserInterface,
    dateRange: DateRanges,
    selectedRangeEndDate: Date | null,
    currentRangeEvents: any[],
    promiseTime: number,
  ): Promise<TripDetectionInput[]> {
    const anchorTimestamp = this.resolveHomeInferenceAnchorTimestamp(selectedRangeEndDate, currentRangeEvents);
    if (anchorTimestamp === null) {
      return [];
    }

    const historyEvents = await this.getEventsForHomeInference(
      user,
      this.buildStartDateWhereClauses(
        anchorTimestamp - TracksComponent.TRIP_HOME_INFERENCE_LOOKBACK_MS,
        anchorTimestamp,
      ),
      promiseTime,
    );

    return this.collectTripDetectionInputsFromEvents(historyEvents);
  }

  private collectTripDetectionInputsFromEvents(events: any[]): TripDetectionInput[] {
    const detectionCandidatesByEvent = new Map<string, TripDetectionInput>();

    (events || [])
      .filter((event) => !event?.isMerge)
      .forEach((event) => {
        const detectionInput = this.getTripDetectionInputFromEvent(event);
        if (!detectionInput) {
          return;
        }

        detectionCandidatesByEvent.set(detectionInput.eventId, detectionInput);
      });

    return Array.from(detectionCandidatesByEvent.values());
  }

  private resolveHomeInferenceAnchorTimestamp(selectedRangeEndDate: Date | null, currentRangeEvents: any[]): number | null {
    if (selectedRangeEndDate && Number.isFinite(selectedRangeEndDate.getTime())) {
      return selectedRangeEndDate.getTime();
    }

    const latestStartTimestamp = (currentRangeEvents || []).reduce((latestTimestamp, event) => {
      const startTimestamp = this.toTimestamp(event?.startDate);
      return startTimestamp !== null
        ? Math.max(latestTimestamp, startTimestamp)
        : latestTimestamp;
    }, Number.NEGATIVE_INFINITY);

    return Number.isFinite(latestStartTimestamp)
      ? latestStartTimestamp
      : null;
  }

  private toTimestamp(value: Date | number | string | undefined): number | null {
    if (value instanceof Date) {
      const timestamp = value.getTime();
      return Number.isFinite(timestamp) ? timestamp : null;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string') {
      const timestamp = Date.parse(value);
      return Number.isFinite(timestamp) ? timestamp : null;
    }

    return null;
  }

  private async updateDetectedTripsForCurrentLoad(
    candidates: TripDetectionInput[],
    homeInferenceCandidates: TripDetectionInput[],
    promiseTime: number,
  ): Promise<void> {
    this.logger.log('[TracksComponent] Running trip detection update.', {
      candidateCount: candidates.length,
      homeInferenceCandidateCount: homeInferenceCandidates.length,
      promiseTime,
      currentPromiseTime: this.promiseTime
    });
    const detectionResult = this.tripDetectionService.detectTripsWithContext(candidates, {
      homeInferenceInputs: homeInferenceCandidates,
    });
    const detectedTrips = detectionResult.trips;
    const detectedHomeArea: DetectedHomeArea | null = detectionResult.homeArea;
    const viewModels = await Promise.all(detectedTrips.map(async (trip) => {
      const coordinateCandidates = this.collectTripLocationCandidates(trip);
      const location = await (
        coordinateCandidates.length > 0
          ? this.tripLocationLabelService.resolveTripLocationFromCandidates(coordinateCandidates)
          : this.tripLocationLabelService.resolveTripLocation(trip.centroidLat, trip.centroidLng)
      );

      return {
        ...trip,
        locationLabel: location?.label || null,
      };
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
    this.detectedHomeArea.set(detectedHomeArea);
    this.tracksMapManager.setHomeArea(detectedHomeArea);
    this.applyActiveDetectedTripAreaOverlay();
    this.detectedTripsPanelExpanded.set(viewModels.length > 0);
    this.hasEvaluatedTripDetection.set(true);
    this.logger.info('[debug] my_tracks_trip_detection_ui_models', {
      trips: viewModels.map((trip) => ({
        tripId: trip.tripId,
        destinationId: trip.destinationId,
        locationLabel: trip.locationLabel,
        activityCount: trip.activityCount,
        startDateIso: trip.startDate.toISOString(),
        endDateIso: trip.endDate.toISOString(),
        eventIds: trip.eventIds,
      })),
      homeArea: detectedHomeArea ? {
        destinationId: detectedHomeArea.destinationId,
        pointCount: detectedHomeArea.pointCount,
        pointShare: detectedHomeArea.pointShare,
        centroidLat: detectedHomeArea.centroidLat,
        centroidLng: detectedHomeArea.centroidLng,
        radiusKm: detectedHomeArea.radiusKm,
      } : null,
    });
    this.logger.log('[TracksComponent] Detected trips committed to UI state.', {
      detectedTripCount: viewModels.length,
      panelExpanded: this.detectedTripsPanelExpanded(),
      hasHomeArea: !!detectedHomeArea,
    });
  }

  private collectTripLocationCandidates(trip: DetectedTrip): TripLocationCoordinateCandidate[] {
    const candidates: TripLocationCoordinateCandidate[] = [];

    trip.eventIds.forEach((eventId) => {
      const event = this.eventsById.get(eventId);
      if (!event) {
        return;
      }

      const tripDetectionInput = this.getTripDetectionInputFromEvent(event);
      if (!tripDetectionInput) {
        return;
      }

      candidates.push({
        latitudeDegrees: tripDetectionInput.latitudeDegrees,
        longitudeDegrees: tripDetectionInput.longitudeDegrees,
      });
    });

    return candidates;
  }

  private applyActiveDetectedTripAreaOverlay(): void {
    const activeTrip = this.resolveActiveDetectedTrip();
    this.tracksMapManager.setTripArea(activeTrip ? this.toTripAreaOverlay(activeTrip) : null);
  }

  private resolveActiveDetectedTrip(): DetectedTripViewModel | null {
    const detectedTrips = this.detectedTrips();
    const hoveredTripId = this.hoveredDetectedTripId();
    if (hoveredTripId === TracksComponent.HOME_PANEL_ENTRY_ID) {
      return null;
    }

    if (hoveredTripId) {
      const hoveredTrip = detectedTrips.find((trip) => trip.tripId === hoveredTripId);
      if (hoveredTrip) {
        return hoveredTrip;
      }
    }

    const selectedTripId = this.selectedDetectedTripId();
    if (selectedTripId === TracksComponent.HOME_PANEL_ENTRY_ID) {
      return null;
    }

    if (!selectedTripId) {
      return null;
    }

    return detectedTrips.find((trip) => trip.tripId === selectedTripId) || null;
  }

  public isHomeEntrySelected(): boolean {
    return this.selectedDetectedTripId() === TracksComponent.HOME_PANEL_ENTRY_ID;
  }

  private toTripAreaOverlay(trip: DetectedTripViewModel): TripAreaOverlay {
    return {
      tripId: trip.tripId,
      centroidLat: trip.centroidLat,
      centroidLng: trip.centroidLng,
      bounds: { ...trip.bounds },
    };
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

  private bindPanPerformanceModeListeners(map: any): void {
    this.unbindPanPerformanceModeListeners();
    if (!map?.on) return;

    this.panPerformanceModeStartHandler = () => {
      if (this.panPerformanceModeResetTimer !== null) {
        clearTimeout(this.panPerformanceModeResetTimer);
        this.panPerformanceModeResetTimer = null;
      }
      this.tracksMapManager.setPanPerformanceMode(true);
    };

    this.panPerformanceModeEndHandler = () => {
      if (this.panPerformanceModeResetTimer !== null) {
        clearTimeout(this.panPerformanceModeResetTimer);
      }
      this.panPerformanceModeResetTimer = setTimeout(() => {
        this.panPerformanceModeResetTimer = null;
        this.tracksMapManager.setPanPerformanceMode(false);
      }, 90);
    };

    ['movestart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach((eventName) => {
      map.on(eventName, this.panPerformanceModeStartHandler);
    });
    ['moveend', 'zoomend', 'rotateend', 'pitchend'].forEach((eventName) => {
      map.on(eventName, this.panPerformanceModeEndHandler);
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

  private unbindPanPerformanceModeListeners(): void {
    if (this.panPerformanceModeResetTimer !== null) {
      clearTimeout(this.panPerformanceModeResetTimer);
      this.panPerformanceModeResetTimer = null;
    }
    const map = this.tracksMapManager.getMap();
    if (map?.off) {
      if (this.panPerformanceModeStartHandler) {
        ['movestart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach((eventName) => {
          map.off(eventName, this.panPerformanceModeStartHandler);
        });
      }
      if (this.panPerformanceModeEndHandler) {
        ['moveend', 'zoomend', 'rotateend', 'pitchend'].forEach((eventName) => {
          map.off(eventName, this.panPerformanceModeEndHandler);
        });
      }
    }
    this.panPerformanceModeStartHandler = null;
    this.panPerformanceModeEndHandler = null;
    this.tracksMapManager.setPanPerformanceMode(false);
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
