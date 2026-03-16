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
import {
  MapboxLayersControlHandle,
  MapboxLayersControlInputs,
  MapboxLayersControlService,
} from '../../services/map/mapbox-layers-control.service';
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
  CachedMyTracksActivityPolyline,
  CachedMyTracksEventPolylines,
  CachedMyTracksJumpHeatPoint,
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

interface ResolvedTrackDataForEventResult {
  fullEvent: any;
  trackPolylines: ResolvedMyTracksActivityPolyline[];
  usedCache: boolean;
  activityFetchDurationMs: number;
  activityCount: number;
}

interface ResolvedMyTracksEventContext {
  sourceEvent: any;
  currentEvent: any;
  eventId: string;
  cacheKey: string | null;
  cachedPolylines?: CachedMyTracksEventPolylines;
  lightweightActivities: any[];
  lightweightCachedPolylines?: CachedMyTracksEventPolylines;
  lightweightTrackPolylines: ResolvedMyTracksActivityPolyline[];
  activityFetchDurationMs: number;
  usedCompleteCache: boolean;
  needsHydrationForPolylines: boolean;
  earlyStartPoints: TrackStartPoint[];
  earlyJumpHeatPoints: JumpHeatPoint[];
  earlyJumpsWithCoordinates: number;
  earlyJumpsWithWeightMetrics: number;
}

interface CollectedTrackRenderData {
  preparedTracks: PreparedTrackPolyline[];
  eventCoordinates: number[][];
  startPoints: TrackStartPoint[];
  jumpHeatPoints: JumpHeatPoint[];
  jumpsWithCoordinates: number;
  jumpsWithWeightMetrics: number;
  tracksProcessed: number;
  tracksSimplified: number;
  inputPointsTotal: number;
  outputPointsTotal: number;
  coordinateExtractionDurationMs: number;
  simplificationDurationMs: number;
  visibleTrackCount: number;
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
  private static readonly MY_TRACKS_BACKGROUND_REFRESH_CONCURRENCY = 4;
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
  private mapLayersControlHandle: MapboxLayersControlHandle | null = null;
  private backgroundActivityRefreshQueue: Array<() => Promise<void>> = [];
  private backgroundActivityRefreshActiveCount = 0;
  private backgroundActivityRefreshEventIds = new Set<string>();

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
    private mapboxLayersControlService: MapboxLayersControlService,
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

    effect(() => {
      const map = this.mapSignal();
      const user = this.userSignal();
      const mapSettings = this.userSettingsQuery.mapSettings() as AppMapSettingsInterface;
      const myTracksSettings = this.userSettingsQuery.myTracksSettings() as AppMyTracksSettings;
      const loading = this.isLoading();

      if (!map || !mapSettings || !myTracksSettings) {
        return;
      }

      this.syncMapLayersControlInputs({
        user,
        disabled: loading,
        mapStyle: this.mapStyleService.normalizeStyle(mapSettings.mapStyle),
        is3D: !!mapSettings.is3D,
        showJumpHeatmap: myTracksSettings.showJumpHeatmap !== false,
        enableJumpHeatmapToggle: true,
        enable3DToggle: true,
        enableLapsToggle: false,
        enableArrowsToggle: false,
        analyticsEventName: 'my_tracks_map_settings_change',
      });
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
        this.zone.run(() => this.attachMapLayersControl(mapInstance));

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
    this.destroyMapLayersControl();
    if (this.mapSignal()) {
      this.mapSignal().remove();
    }
  }

  private attachMapLayersControl(map: any): void {
    if (this.mapLayersControlHandle) {
      this.syncMapLayersControlInputs();
      return;
    }

    this.mapLayersControlHandle = this.mapboxLayersControlService.create({
      outputs: {
        mapStyleChange: (style) => this.setMapStyle(style as MapStyleName),
        is3DChange: (value) => this.onMyTracks3DToggle(value),
        showJumpHeatmapChange: (value) => this.onShowJumpHeatmapToggle(value),
      },
    });

    map.addControl(this.mapLayersControlHandle.control, 'bottom-right');
    this.syncMapLayersControlInputs();
  }

  private syncMapLayersControlInputs(overrideInputs: Partial<MapboxLayersControlInputs> = {}): void {
    if (!this.mapLayersControlHandle) {
      return;
    }

    const mapSettings = this.userSettingsQuery.mapSettings() as AppMapSettingsInterface;
    const myTracksSettings = this.userSettingsQuery.myTracksSettings() as AppMyTracksSettings;

    this.mapLayersControlHandle.updateInputs({
      user: this.userSignal(),
      disabled: this.isLoading(),
      mapStyle: this.mapStyleService.normalizeStyle(mapSettings?.mapStyle),
      is3D: !!mapSettings?.is3D,
      showJumpHeatmap: myTracksSettings?.showJumpHeatmap !== false,
      enableJumpHeatmapToggle: true,
      enable3DToggle: true,
      enableLapsToggle: false,
      enableArrowsToggle: false,
      analyticsEventName: 'my_tracks_map_settings_change',
      ...overrideInputs,
    });
  }

  private destroyMapLayersControl(): void {
    if (!this.mapLayersControlHandle) {
      return;
    }

    this.mapLayersControlHandle.destroy();
    this.mapLayersControlHandle = null;
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
    this.backgroundActivityRefreshQueue = [];
    this.backgroundActivityRefreshEventIds.clear();
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
      this.eventsById = this.buildEventsByIdMap(events);
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

      this.updateBufferProgress(100);

      if (!this.isCurrentLoad(promiseTime)) {
        return;
      }
      const earlyTripCandidates = this.collectTripDetectionInputsForCurrentRange(events, activityTypes);
      const earlyHomeInferenceCandidates = dateRange === DateRanges.all
        ? earlyTripCandidates
        : historicalHomeInferenceCandidates;
      const earlyTripDetectionStartedAt = performance.now();
      await this.updateDetectedTripsForCurrentLoad(
        earlyTripCandidates,
        earlyHomeInferenceCandidates,
        promiseTime,
      );
      tripDetectionDurationMs += performance.now() - earlyTripDetectionStartedAt;

      if (!this.isCurrentLoad(promiseTime)) {
        return;
      }

      const chunkedEvents = this.chunkItems(events, 15);
      const lightweightContexts: ResolvedMyTracksEventContext[] = [];
      const earlyStartPoints: TrackStartPoint[] = [];
      const earlyJumpHeatPoints: JumpHeatPoint[] = [];
      let earlyJumpsWithCoordinates = 0;
      let earlyJumpsWithWeightMetrics = 0;

      for (const eventsChunk of chunkedEvents) {
        if (!this.isCurrentLoad(promiseTime)) {
          return;
        }

        const chunkContexts = await Promise.all(eventsChunk.map(async (event: any) => {
          const context = await this.resolveLightweightEventContext(user, event, activityTypes);
          activitiesFetchDurationMs += context.activityFetchDurationMs;
          if (context.usedCompleteCache) {
            polylineCacheHitCount += 1;
          } else {
            polylineCacheMissCount += 1;
          }
          return context;
        }));

        if (!this.isCurrentLoad(promiseTime)) {
          return;
        }

        chunkContexts.forEach((context) => {
          lightweightContexts.push(context);
          earlyStartPoints.push(...context.earlyStartPoints);
          earlyJumpHeatPoints.push(...context.earlyJumpHeatPoints);
          earlyJumpsWithCoordinates += context.earlyJumpsWithCoordinates;
          earlyJumpsWithWeightMetrics += context.earlyJumpsWithWeightMetrics;
        });
      }

      if (!this.isCurrentLoad(promiseTime)) {
        return;
      }

      const mergedEarlyStartPoints = this.mergeTrackStartPoints(earlyStartPoints);
      const mergedEarlyJumpHeatPoints = this.mergeJumpHeatPoints(earlyJumpHeatPoints);

      this.eventsById = this.buildEventsByIdMap(lightweightContexts.map((context) => context.currentEvent));
      if (mergedEarlyStartPoints.length > 0) {
        this.tracksMapManager.setActivityStartPoints(mergedEarlyStartPoints);
      } else {
        this.tracksMapManager.clearActivityStartPoints();
      }

      if (mergedEarlyJumpHeatPoints.length > 0) {
        this.hasDetectedJumps.set(true);
        this.tracksMapManager.setJumpHeatPoints(mergedEarlyJumpHeatPoints);
      } else {
        this.hasDetectedJumps.set(false);
        this.tracksMapManager.clearJumpHeatmap();
      }

      const correctedTripCandidates = this.collectTripDetectionInputsFromContexts(lightweightContexts, activityTypes);
      if (this.haveTripCandidatesChanged(earlyTripCandidates, correctedTripCandidates)) {
        const correctedHomeInferenceCandidates = dateRange === DateRanges.all
          ? correctedTripCandidates
          : historicalHomeInferenceCandidates;
        const correctedTripDetectionStartedAt = performance.now();
        await this.updateDetectedTripsForCurrentLoad(
          correctedTripCandidates,
          correctedHomeInferenceCandidates,
          promiseTime,
        );
        tripDetectionDurationMs += performance.now() - correctedTripDetectionStartedAt;
      }

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
      const stagedEventsById = this.buildEventsByIdMap(lightweightContexts.map((context) => context.currentEvent));
      let jumpsWithCoordinates = 0;
      let jumpsWithWeightMetrics = 0;
      let tracksProcessed = 0;
      let tracksSimplified = 0;
      let inputPointsTotal = 0;
      let outputPointsTotal = 0;
      const contextChunks = this.chunkItems(lightweightContexts, 15);

      for (const contextsChunk of contextChunks) {
        if (!this.isCurrentLoad(promiseTime)) {
          return;
        }

        await Promise.all(contextsChunk.map(async (context) => {
          if (!this.isCurrentLoad(promiseTime)) {
            return;
          }

          const eventProcessingStartedAt = performance.now();
          const sourceEventId = context.eventId || 'unknown-event';
          let eventHydrationDurationMs = 0;
          const eventHydrationStartedAt = performance.now();
          const resolvedTrackData = await this.resolveTrackDataForEventContext(user, context);
          if (context.needsHydrationForPolylines) {
            eventHydrationDurationMs = performance.now() - eventHydrationStartedAt;
            streamsHydrationDurationMs += eventHydrationDurationMs;
          }

          this.logger.log(`[TracksComponent] Track data ready for event: ${context.eventId}, promiseTime: ${promiseTime}`);
          if (!this.isCurrentLoad(promiseTime)) {
            return;
          }

          const eventId = resolvedTrackData.fullEvent?.getID?.() || sourceEventId;
          if (eventId) {
            stagedEventsById.set(eventId, resolvedTrackData.fullEvent || context.currentEvent);
          }

          const collectedTrackData = this.collectTrackRenderDataFromResolvedTrackData(
            resolvedTrackData,
            context.sourceEvent,
            activityTypes,
            events.length,
          );

          coordinateExtractionDurationMs += collectedTrackData.coordinateExtractionDurationMs;
          simplificationDurationMs += collectedTrackData.simplificationDurationMs;
          jumpsWithCoordinates += collectedTrackData.jumpsWithCoordinates;
          jumpsWithWeightMetrics += collectedTrackData.jumpsWithWeightMetrics;
          tracksProcessed += collectedTrackData.tracksProcessed;
          tracksSimplified += collectedTrackData.tracksSimplified;
          inputPointsTotal += collectedTrackData.inputPointsTotal;
          outputPointsTotal += collectedTrackData.outputPointsTotal;
          trackStartPoints.push(...collectedTrackData.startPoints);
          jumpHeatPoints.push(...collectedTrackData.jumpHeatPoints);
          preparedTracks.push(...collectedTrackData.preparedTracks);
          addedTrackCount += collectedTrackData.visibleTrackCount;

          if (collectedTrackData.eventCoordinates.length > 0 && eventId) {
            stagedTrackCoordinatesByEventId.set(eventId, collectedTrackData.eventCoordinates);
            collectedTrackData.eventCoordinates.forEach((coordinate: number[]) => {
              allCoordinates.push(coordinate);
            });
          }

          const eventTotalMs = performance.now() - eventProcessingStartedAt;
          perEventPerformance.push({
            eventId,
            totalMs: eventTotalMs,
            activitiesFetchMs: context.activityFetchDurationMs,
            hydrationMs: eventHydrationDurationMs,
            coordinateExtractionMs: collectedTrackData.coordinateExtractionDurationMs,
            simplificationMs: collectedTrackData.simplificationDurationMs,
            activityCount: resolvedTrackData.activityCount,
            visibleTrackCount: collectedTrackData.visibleTrackCount,
            inputPoints: collectedTrackData.inputPointsTotal,
            outputPoints: collectedTrackData.outputPointsTotal,
          });

          count++;
          this.updateTotalProgress(Math.ceil((count / lightweightContexts.length) * 100));
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

      this.tracksMapManager.clearTrackLayers();
      if (addedTrackCount > 0) {
        this.tracksMapManager.setTracksFromPrepared(preparedTracks);
      }

      const mergedTrackStartPoints = this.mergeTrackStartPoints(mergedEarlyStartPoints, trackStartPoints);
      if (mergedTrackStartPoints.length > 0) {
        this.tracksMapManager.setActivityStartPoints(mergedTrackStartPoints);
        await this.waitForStartPointLayerReady();
      } else {
        this.tracksMapManager.clearActivityStartPoints();
      }

      if (allCoordinates.length > 0) {
        await this.waitForMapRenderTick();
        this.fitBoundsToTracks(allCoordinates);
      }
      const mergedJumpHeatPoints = this.mergeJumpHeatPoints(mergedEarlyJumpHeatPoints, jumpHeatPoints);
      if (mergedJumpHeatPoints.length > 0) {
        this.hasDetectedJumps.set(true);
        this.tracksMapManager.setJumpHeatPoints(mergedJumpHeatPoints);
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
        jumpsWithCoordinates: jumpsWithCoordinates + earlyJumpsWithCoordinates,
        jumpsWithWeightMetrics: jumpsWithWeightMetrics + earlyJumpsWithWeightMetrics,
        renderableHeatPoints: mergedJumpHeatPoints.length,
        promiseTime
      });
      this.logger.log('[TracksComponent] Prepared trip detection candidates.', {
        candidateCount: correctedTripCandidates.length,
        homeInferenceCandidateCount: (dateRange === DateRanges.all
          ? correctedTripCandidates
          : historicalHomeInferenceCandidates).length,
        promiseTime
      });

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

  private async resolveLightweightEventContext(
    user: AppUserInterface,
    event: any,
    activityTypes?: ActivityTypes[],
  ): Promise<ResolvedMyTracksEventContext> {
    const cacheOptions = { metadataCacheTtlMs: TracksComponent.MY_TRACKS_METADATA_CACHE_TTL_MS };
    const initialActivities = this.getEventActivities(event);
    const eventId = event?.getID?.();
    const cacheKey = await this.myTracksPolylineCacheService.resolveEventCacheKey(event, cacheOptions);
    const cachedPolylines = cacheKey
      ? await this.myTracksPolylineCacheService.getEventPolylines(cacheKey)
      : undefined;

    if (this.isValidCachedTrackData(initialActivities, cachedPolylines)) {
      if (cacheKey && eventId) {
        this.enqueueBackgroundActivityRefresh(user, eventId, cacheKey, cachedPolylines);
      }
      const lightweightTrackPolylines = initialActivities.length > 0
          ? this.myTracksPolylineCacheService.resolveTrackPolylines(initialActivities, cachedPolylines)
          : this.myTracksPolylineCacheService.resolveTrackPolylinesFromCache(cachedPolylines);
      const earlyOverlayData = this.collectOverlayDataFromResolvedTrackPolylines(
        lightweightTrackPolylines,
        event,
        activityTypes,
        initialActivities,
      );

      return {
        sourceEvent: event,
        currentEvent: event,
        eventId: eventId || 'unknown-event',
        cacheKey,
        cachedPolylines,
        lightweightActivities: initialActivities,
        lightweightCachedPolylines: cachedPolylines,
        lightweightTrackPolylines,
        activityFetchDurationMs: 0,
        usedCompleteCache: true,
        needsHydrationForPolylines: false,
        earlyStartPoints: earlyOverlayData.earlyStartPoints,
        earlyJumpHeatPoints: earlyOverlayData.earlyJumpHeatPoints,
        earlyJumpsWithCoordinates: earlyOverlayData.earlyJumpsWithCoordinates,
        earlyJumpsWithWeightMetrics: earlyOverlayData.earlyJumpsWithWeightMetrics,
      };
    }

    this.logger.log(`[TracksComponent] Fetching activities for event: ${eventId}, promiseTime: ${this.promiseTime}`);
    const eventActivitiesFetchStartedAt = performance.now();
    const fetchedActivities = eventId
      ? await firstValueFrom(this.eventService.getActivitiesOnceByEventWithOptions(
        user,
        eventId,
        { preferCache: true, warmServer: false },
      ))
      : [];
    const activityFetchDurationMs = performance.now() - eventActivitiesFetchStartedAt;
    if (fetchedActivities.length > 0 && typeof event?.addActivities === 'function') {
      if (typeof event?.clearActivities === 'function') {
        event.clearActivities();
      }
      event.addActivities(fetchedActivities);
    }

    const lightweightActivities = fetchedActivities.length > 0
      ? fetchedActivities
      : initialActivities;
    const lightweightCachedPolylines = this.buildCachedTrackPolylinesWithMetadata(
      this.myTracksPolylineCacheService.extractTrackPolylines(lightweightActivities),
      lightweightActivities,
    );
    const lightweightTrackPolylines = lightweightActivities.length > 0
      ? this.myTracksPolylineCacheService.resolveTrackPolylines(lightweightActivities, lightweightCachedPolylines)
      : [];
    const earlyOverlayData = this.collectOverlayDataFromResolvedTrackPolylines(
      lightweightTrackPolylines,
      event,
      activityTypes,
      lightweightActivities,
    );

    return {
      sourceEvent: event,
      currentEvent: event,
      eventId: eventId || 'unknown-event',
      cacheKey,
      cachedPolylines,
      lightweightActivities,
      lightweightCachedPolylines,
      lightweightTrackPolylines,
      activityFetchDurationMs,
      usedCompleteCache: false,
      needsHydrationForPolylines: this.shouldHydrateTrackDataForActivities(lightweightActivities, activityTypes),
      earlyStartPoints: earlyOverlayData.earlyStartPoints,
      earlyJumpHeatPoints: earlyOverlayData.earlyJumpHeatPoints,
      earlyJumpsWithCoordinates: earlyOverlayData.earlyJumpsWithCoordinates,
      earlyJumpsWithWeightMetrics: earlyOverlayData.earlyJumpsWithWeightMetrics,
    };
  }

  private async resolveTrackDataForEventContext(
    user: AppUserInterface,
    context: ResolvedMyTracksEventContext,
  ): Promise<ResolvedTrackDataForEventResult> {
    if (!context.needsHydrationForPolylines) {
      if (
        !context.usedCompleteCache
        && context.cacheKey
        && context.lightweightCachedPolylines
        && this.shouldPersistTrackData(context.currentEvent, context.sourceEvent, context.lightweightActivities)
      ) {
        await this.myTracksPolylineCacheService.setEventPolylines(context.cacheKey, context.lightweightCachedPolylines);
      }

      return {
        fullEvent: context.currentEvent,
        trackPolylines: context.lightweightTrackPolylines,
        usedCache: context.usedCompleteCache,
        activityFetchDurationMs: context.activityFetchDurationMs,
        activityCount: context.usedCompleteCache
          ? context.cachedPolylines?.activityCount || context.lightweightTrackPolylines.length
          : context.lightweightActivities.length,
      };
    }

    const fullEvent = await this.hydrateTrackStreamsForEvent(user, context.currentEvent);
    const resolvedActivities = this.getEventActivities(fullEvent);
    const extractedPolylines = this.buildCachedTrackPolylinesWithMetadata(
      this.myTracksPolylineCacheService.extractTrackPolylines(resolvedActivities),
      resolvedActivities,
    );
    if (context.cacheKey && this.shouldPersistTrackData(fullEvent, context.sourceEvent, resolvedActivities)) {
      await this.myTracksPolylineCacheService.setEventPolylines(context.cacheKey, extractedPolylines);
    }

    return {
      fullEvent,
      trackPolylines: this.myTracksPolylineCacheService.resolveTrackPolylines(resolvedActivities, extractedPolylines),
      usedCache: false,
      activityFetchDurationMs: context.activityFetchDurationMs,
      activityCount: resolvedActivities.length,
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
    const allowUnknownIdentity = activities.length === 0;
    return this.myTracksPolylineCacheService.hasMatchingActivityIdentity(activities, cachedPolylines, allowUnknownIdentity)
      && this.myTracksPolylineCacheService.hasCompleteTrackMetadata(cachedPolylines);
  }

  private shouldPersistTrackData(fullEvent: any, sourceEvent: any, activities: any[]): boolean {
    if (fullEvent !== sourceEvent) {
      return true;
    }

    return activities.some((activity) => activity?.hasPositionData?.());
  }

  private buildCachedTrackPolylinesWithMetadata(
    basePolylines: CachedMyTracksEventPolylines,
    activities: any[],
  ): CachedMyTracksEventPolylines {
    const resolvedTrackPolylines = this.myTracksPolylineCacheService.resolveTrackPolylines(activities, basePolylines);
    const trackActivities = resolvedTrackPolylines.reduce<CachedMyTracksActivityPolyline[]>((accumulator, resolvedTrackPolyline) => {
      const { activity, activityIndex, coordinates, cachedActivity } = resolvedTrackPolyline;
      const activityId = activity?.getID?.();
      accumulator.push({
        activityId: typeof activityId === 'string' && activityId.trim().length > 0
          ? activityId
          : cachedActivity?.activityId || null,
        activityIndex,
        coordinates,
        activityTypeValue: this.getActivityTypeValue(activity),
        activityTypeLabel: this.resolveActivityTypeLabel(activity),
        durationValue: this.getNumericActivityStatValue(activity?.getDuration?.()),
        distanceValue: this.getNumericActivityStatValue(activity?.getDistance?.()),
        durationLabel: this.formatActivityDurationLabel(activity),
        distanceLabel: this.formatActivityDistanceLabel(activity),
        effortLabel: this.resolveActivityEffortMetric(activity).effortLabel || null,
        effortDisplayLabel: this.resolveActivityEffortMetric(activity).effortDisplayLabel || '-',
        effortStatType: this.resolveActivityEffortMetric(activity).effortStatType || null,
        jumpHeatPoints: this.extractCachedJumpHeatPointsFromActivity(activity),
      });
      return accumulator;
    }, []);

    return {
      activityCount: basePolylines.activityCount,
      activityIdentitySignature: [...(basePolylines.activityIdentitySignature || [])],
      trackActivities,
    };
  }

  private buildEventsByIdMap(events: any[]): Map<string, any> {
    return (events || []).reduce((accumulator, event) => {
      const eventId = event?.getID?.();
      if (eventId) {
        accumulator.set(eventId, event);
      }
      return accumulator;
    }, new Map<string, any>());
  }

  private chunkItems<T>(items: T[], chunkSize: number): T[][] {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
      return [items];
    }

    return items.reduce((all: T[][], one: T, index: number) => {
      const chunkIndex = Math.floor(index / chunkSize);
      all[chunkIndex] = ([] as T[]).concat((all[chunkIndex] || []), one);
      return all;
    }, []);
  }

  private collectTripDetectionInputsForCurrentRange(events: any[], activityTypes?: ActivityTypes[]): TripDetectionInput[] {
    const detectionCandidatesByEvent = new Map<string, TripDetectionInput>();

    (events || []).forEach((event) => {
      if (this.eventMatchesRequestedActivityTypes(event, activityTypes) !== true) {
        return;
      }

      const detectionInput = this.getTripDetectionInputFromEvent(event);
      if (detectionInput) {
        detectionCandidatesByEvent.set(detectionInput.eventId, detectionInput);
      }
    });

    return Array.from(detectionCandidatesByEvent.values());
  }

  private collectTripDetectionInputsFromContexts(
    contexts: ResolvedMyTracksEventContext[],
    activityTypes?: ActivityTypes[],
  ): TripDetectionInput[] {
    const detectionCandidatesByEvent = new Map<string, TripDetectionInput>();

    (contexts || []).forEach((context) => {
      if (!this.contextMatchesRequestedActivityTypes(context, activityTypes)) {
        return;
      }

      const detectionInput = this.getTripDetectionInputFromEvent(context.currentEvent || context.sourceEvent);
      if (detectionInput) {
        detectionCandidatesByEvent.set(detectionInput.eventId, detectionInput);
      }
    });

    return Array.from(detectionCandidatesByEvent.values());
  }

  private haveTripCandidatesChanged(
    previousCandidates: TripDetectionInput[],
    nextCandidates: TripDetectionInput[],
  ): boolean {
    const previousIds = [...new Set((previousCandidates || []).map((candidate) => candidate.eventId).filter(Boolean))]
      .sort();
    const nextIds = [...new Set((nextCandidates || []).map((candidate) => candidate.eventId).filter(Boolean))]
      .sort();

    if (previousIds.length !== nextIds.length) {
      return true;
    }

    return previousIds.some((eventId, index) => eventId !== nextIds[index]);
  }

  private collectOverlayDataFromResolvedTrackPolylines(
    trackPolylines: ResolvedMyTracksActivityPolyline[],
    event: any,
    activityTypes?: ActivityTypes[],
    activities: any[] = [],
  ): Pick<ResolvedMyTracksEventContext, 'earlyStartPoints' | 'earlyJumpHeatPoints' | 'earlyJumpsWithCoordinates' | 'earlyJumpsWithWeightMetrics'> {
    const eventId = event?.getID?.();
    const startDateInput = event?.startDate;
    const startPoints: TrackStartPoint[] = [];
    const jumpHeatPoints: JumpHeatPoint[] = [];
    const representedActivityKeys = new Set<string>();
    let jumpsWithCoordinates = 0;
    let jumpsWithWeightMetrics = 0;

    this.filterResolvedTrackPolylinesByActivityTypes(trackPolylines, activityTypes)
      .forEach(({ activity, activityIndex, coordinates, cachedActivity }) => {
        const hasCompleteCachedMetadata = this.isCachedActivityMetadataComplete(cachedActivity);
        representedActivityKeys.add(this.buildActivityOverlayKey(activity, activityIndex, cachedActivity));

        const jumpStats = hasCompleteCachedMetadata
          ? this.collectJumpHeatPointsFromCachedActivity(cachedActivity, jumpHeatPoints)
          : this.collectJumpHeatPointsFromActivity(activity, jumpHeatPoints);
        jumpsWithCoordinates += jumpStats.jumpsWithCoordinates;
        jumpsWithWeightMetrics += jumpStats.jumpsWithWeightMetrics;

        if (!Array.isArray(coordinates) || coordinates.length <= 1 || !eventId) {
          return;
        }

        const startPoint = hasCompleteCachedMetadata
          ? this.buildTrackStartPointFromCached(cachedActivity, eventId, coordinates[0], startDateInput)
          : this.buildTrackStartPoint(activity, eventId, coordinates[0], startDateInput);
        if (startPoint) {
          startPoints.push(startPoint);
        }
      });

    (activities || [])
      .filter((activity, activityIndex) => (
        this.activityMatchesRequestedActivityTypes(activity, activityTypes)
        && !representedActivityKeys.has(this.buildActivityOverlayKey(activity, activityIndex))
      ))
      .forEach((activity) => {
        const jumpStats = this.collectJumpHeatPointsFromActivity(activity, jumpHeatPoints);
        jumpsWithCoordinates += jumpStats.jumpsWithCoordinates;
        jumpsWithWeightMetrics += jumpStats.jumpsWithWeightMetrics;
      });

    return {
      earlyStartPoints: startPoints,
      earlyJumpHeatPoints: jumpHeatPoints,
      earlyJumpsWithCoordinates: jumpsWithCoordinates,
      earlyJumpsWithWeightMetrics: jumpsWithWeightMetrics,
    };
  }

  private collectTrackRenderDataFromResolvedTrackData(
    resolvedTrackData: ResolvedTrackDataForEventResult,
    sourceEvent: any,
    activityTypes: ActivityTypes[] | undefined,
    totalEventCount: number,
  ): CollectedTrackRenderData {
    const eventId = resolvedTrackData.fullEvent?.getID?.() || sourceEvent?.getID?.();
    const startDateInput = resolvedTrackData.fullEvent?.startDate ?? sourceEvent?.startDate;
    const renderData: CollectedTrackRenderData = {
      preparedTracks: [],
      eventCoordinates: [],
      startPoints: [],
      jumpHeatPoints: [],
      jumpsWithCoordinates: 0,
      jumpsWithWeightMetrics: 0,
      tracksProcessed: 0,
      tracksSimplified: 0,
      inputPointsTotal: 0,
      outputPointsTotal: 0,
      coordinateExtractionDurationMs: 0,
      simplificationDurationMs: 0,
      visibleTrackCount: 0,
    };

    this.filterResolvedTrackPolylinesByActivityTypes(resolvedTrackData.trackPolylines, activityTypes)
      .forEach(({ activity, coordinates, cachedActivity }) => {
        const hasCompleteCachedMetadata = this.isCachedActivityMetadataComplete(cachedActivity);
        const jumpStats = hasCompleteCachedMetadata
          ? this.collectJumpHeatPointsFromCachedActivity(cachedActivity, renderData.jumpHeatPoints)
          : this.collectJumpHeatPointsFromActivity(activity, renderData.jumpHeatPoints);
        renderData.jumpsWithCoordinates += jumpStats.jumpsWithCoordinates;
        renderData.jumpsWithWeightMetrics += jumpStats.jumpsWithWeightMetrics;

        const coordinateExtractionStartedAt = performance.now();
        const normalizedCoordinates = coordinates;
        renderData.coordinateExtractionDurationMs += performance.now() - coordinateExtractionStartedAt;

        if (!Array.isArray(normalizedCoordinates) || normalizedCoordinates.length <= 1) {
          return;
        }

        const simplificationStartedAt = performance.now();
        const simplificationResult = this.polylineSimplificationService.simplifyVisvalingamWhyatt(
          normalizedCoordinates,
          this.resolveMyTracksSimplificationOptions(normalizedCoordinates.length, totalEventCount)
        );
        renderData.simplificationDurationMs += performance.now() - simplificationStartedAt;

        renderData.tracksProcessed += 1;
        renderData.inputPointsTotal += simplificationResult.inputPointCount;
        renderData.outputPointsTotal += simplificationResult.outputPointCount;
        if (simplificationResult.simplified) {
          renderData.tracksSimplified += 1;
        }

        if (eventId) {
          const startPoint = hasCompleteCachedMetadata
            ? this.buildTrackStartPointFromCached(cachedActivity, eventId, normalizedCoordinates[0], startDateInput)
            : this.buildTrackStartPoint(activity, eventId, normalizedCoordinates[0], startDateInput);
          if (startPoint) {
            renderData.startPoints.push(startPoint);
          }
        }

        renderData.preparedTracks.push({ activity, coordinates: simplificationResult.coordinates });
        renderData.visibleTrackCount += 1;
        simplificationResult.coordinates.forEach((coordinate: number[]) => {
          renderData.eventCoordinates.push(coordinate);
        });
      });

    return renderData;
  }

  private eventMatchesRequestedActivityTypes(event: any, activityTypes?: ActivityTypes[]): boolean | null {
    return this.matchesRequestedActivityTypes(this.getEventActivityTypeValues(event), activityTypes);
  }

  private contextMatchesRequestedActivityTypes(
    context: ResolvedMyTracksEventContext,
    activityTypes?: ActivityTypes[],
  ): boolean {
    if (!activityTypes || activityTypes.length === 0) {
      return true;
    }

    const cachedActivityTypes = context.usedCompleteCache
      ? (context.cachedPolylines?.trackActivities || []).map((trackActivity) => trackActivity.activityTypeValue)
      : context.lightweightActivities.map((activity) => this.getActivityTypeValue(activity));

    return this.matchesRequestedActivityTypes(cachedActivityTypes, activityTypes) === true;
  }

  private filterResolvedTrackPolylinesByActivityTypes(
    trackPolylines: ResolvedMyTracksActivityPolyline[],
    activityTypes?: ActivityTypes[],
  ): ResolvedMyTracksActivityPolyline[] {
    if (!activityTypes || activityTypes.length === 0) {
      return trackPolylines || [];
    }

    return (trackPolylines || []).filter(({ activity, cachedActivity }) => (
      this.matchesRequestedActivityTypes(
        [this.getActivityTypeValue(activity), cachedActivity?.activityTypeValue],
        activityTypes,
      ) === true
    ));
  }

  private shouldHydrateTrackDataForActivities(activities: any[], activityTypes?: ActivityTypes[]): boolean {
    const matchingActivities = (activities || []).filter((activity) => this.activityMatchesRequestedActivityTypes(activity, activityTypes));
    if (matchingActivities.length === 0) {
      return false;
    }

    return matchingActivities.some((activity) => {
      const activityId = activity?.getID?.();
      const exactCoordinates = this.getExactCoordinatesFromActivity(activity);
      return !(typeof activityId === 'string' && activityId.trim().length > 0 && exactCoordinates.length > 1);
    });
  }

  private activityMatchesRequestedActivityTypes(activity: any, activityTypes?: ActivityTypes[]): boolean {
    return this.matchesRequestedActivityTypes([this.getActivityTypeValue(activity)], activityTypes) === true;
  }

  private getEventActivityTypeValues(event: any): Array<ActivityTypes | string | number> {
    const eventActivityTypes = typeof event?.getActivityTypesAsArray === 'function'
      ? event.getActivityTypesAsArray()
      : [];

    if (Array.isArray(eventActivityTypes) && eventActivityTypes.length > 0) {
      return eventActivityTypes;
    }

    return this.getEventActivities(event)
      .map((activity) => this.getActivityTypeValue(activity))
      .filter((value): value is ActivityTypes | string | number => value !== null);
  }

  private matchesRequestedActivityTypes(
    candidateTypes: Array<ActivityTypes | string | number | null | undefined>,
    activityTypes?: ActivityTypes[],
  ): boolean | null {
    if (!activityTypes || activityTypes.length === 0) {
      return true;
    }

    const requestedTypes = new Set(
      activityTypes
        .map((activityType) => this.normalizeActivityTypeFilterValue(activityType))
        .filter((activityType): activityType is string => !!activityType)
    );
    const normalizedCandidateTypes = (candidateTypes || [])
      .map((activityType) => this.normalizeActivityTypeFilterValue(activityType))
      .filter((activityType): activityType is string => !!activityType);

    if (requestedTypes.size === 0 || normalizedCandidateTypes.length === 0) {
      return null;
    }

    return normalizedCandidateTypes.some((activityType) => requestedTypes.has(activityType));
  }

  private normalizeActivityTypeFilterValue(
    value: ActivityTypes | string | number | null | undefined,
  ): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const enumValue = (ActivityTypes as any)[value];
      if (typeof enumValue === 'string' && enumValue.trim().length > 0) {
        return enumValue.trim().toLowerCase();
      }
      return `${value}`;
    }

    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized.length === 0) {
        return null;
      }

      const enumValue = (ActivityTypes as any)[normalized];
      if (typeof enumValue === 'string' && enumValue.trim().length > 0) {
        return enumValue.trim().toLowerCase();
      }

      return normalized.toLowerCase();
    }

    return null;
  }

  private getExactCoordinatesFromActivity(activity: any): number[][] {
    const positionData = typeof activity?.getPositionData === 'function'
      ? activity.getPositionData() || []
      : [];

    return (positionData || [])
      .map((position: any) => [position?.longitudeDegrees, position?.latitudeDegrees])
      .filter((coordinate: number[]) =>
        Array.isArray(coordinate)
        && coordinate.length >= 2
        && Number.isFinite(coordinate[0])
        && Number.isFinite(coordinate[1])
        && Math.abs(coordinate[0]) <= 180
        && Math.abs(coordinate[1]) <= 90
      );
  }

  private mergeTrackStartPoints(...collections: TrackStartPoint[][]): TrackStartPoint[] {
    const merged = new Map<string, TrackStartPoint>();

    collections.flat().forEach((startPoint) => {
      if (!startPoint?.eventId || !startPoint?.activityId) {
        return;
      }

      merged.set(`${startPoint.eventId}|${startPoint.activityId}`, startPoint);
    });

    return Array.from(merged.values());
  }

  private mergeJumpHeatPoints(...collections: JumpHeatPoint[][]): JumpHeatPoint[] {
    const merged = new Map<string, JumpHeatPoint>();

    collections.flat().forEach((point) => {
      if (!point || !Number.isFinite(point.lng) || !Number.isFinite(point.lat)) {
        return;
      }

      const key = [
        point.lng.toFixed(6),
        point.lat.toFixed(6),
        point.hangTime === null ? 'null' : point.hangTime,
        point.distance === null ? 'null' : point.distance,
      ].join('|');

      if (!merged.has(key)) {
        merged.set(key, point);
      }
    });

    return Array.from(merged.values());
  }

  private isCachedActivityMetadataComplete(cachedActivity: CachedMyTracksActivityPolyline | undefined): cachedActivity is CachedMyTracksActivityPolyline {
    return !!cachedActivity
      && typeof cachedActivity.activityId === 'string'
      && cachedActivity.activityId.trim().length > 0
      && this.hasValidCoordinates(cachedActivity.coordinates)
      && this.hasValidActivityTypeValue(cachedActivity.activityTypeValue)
      && typeof cachedActivity.activityTypeLabel === 'string'
      && cachedActivity.activityTypeLabel.trim().length > 0
      && this.isNullableNonNegativeNumber(cachedActivity.durationValue)
      && this.isNullableNonNegativeNumber(cachedActivity.distanceValue)
      && typeof cachedActivity.durationLabel === 'string'
      && cachedActivity.durationLabel.length > 0
      && typeof cachedActivity.distanceLabel === 'string'
      && cachedActivity.distanceLabel.length > 0
      && typeof cachedActivity.effortLabel === 'string'
      && cachedActivity.effortLabel.length > 0
      && typeof cachedActivity.effortDisplayLabel === 'string'
      && cachedActivity.effortDisplayLabel.length > 0
      && typeof cachedActivity.effortStatType === 'string'
      && cachedActivity.effortStatType.length > 0
      && Array.isArray(cachedActivity.jumpHeatPoints)
      && cachedActivity.jumpHeatPoints.every((point) => this.isValidCachedJumpHeatPoint(point));
  }

  private enqueueBackgroundActivityRefresh(
    user: AppUserInterface,
    eventId: string,
    cacheKey: string,
    cachedPolylines: CachedMyTracksEventPolylines,
  ): void {
    if (!eventId || !cacheKey || this.backgroundActivityRefreshEventIds.has(eventId)) {
      return;
    }

    this.backgroundActivityRefreshEventIds.add(eventId);
    this.backgroundActivityRefreshQueue.push(async () => {
      try {
        const refreshedActivities = await firstValueFrom(this.eventService.getActivitiesOnceByEventWithOptions(
          user,
          eventId,
          { preferCache: false },
        ));

        if (!this.myTracksPolylineCacheService.hasMatchingActivityIdentity(refreshedActivities, cachedPolylines)) {
          await this.myTracksPolylineCacheService.deleteEventPolylines(cacheKey);
          return;
        }

        const refreshedPolylines = this.buildCachedTrackPolylinesWithMetadata(cachedPolylines, refreshedActivities);
        await this.myTracksPolylineCacheService.setEventPolylines(cacheKey, refreshedPolylines);
      } catch (error) {
        this.logger.warn('[TracksComponent] Background my-tracks activity refresh failed.', {
          eventId,
          cacheKey,
          error,
        });
      }
    });

    this.processBackgroundActivityRefreshQueue();
  }

  private processBackgroundActivityRefreshQueue(): void {
    while (
      this.backgroundActivityRefreshActiveCount < TracksComponent.MY_TRACKS_BACKGROUND_REFRESH_CONCURRENCY
      && this.backgroundActivityRefreshQueue.length > 0
    ) {
      const nextRefresh = this.backgroundActivityRefreshQueue.shift();
      if (!nextRefresh) {
        return;
      }

      this.backgroundActivityRefreshActiveCount += 1;
      void nextRefresh().finally(() => {
        this.backgroundActivityRefreshActiveCount = Math.max(0, this.backgroundActivityRefreshActiveCount - 1);
        this.processBackgroundActivityRefreshQueue();
      });
    }
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

  private buildActivityOverlayKey(
    activity: any,
    activityIndex: number,
    cachedActivity?: CachedMyTracksActivityPolyline,
  ): string {
    const activityId = activity?.getID?.();
    if (typeof activityId === 'string' && activityId.trim().length > 0) {
      return `id:${activityId}`;
    }

    if (cachedActivity?.activityId) {
      return `id:${cachedActivity.activityId}`;
    }

    return `idx:${activityIndex}`;
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
    return this.collectJumpHeatPoints(
      this.extractCachedJumpHeatPointsFromActivity(activity),
      jumpHeatPoints,
    );
  }

  private collectJumpHeatPointsFromCachedActivity(
    cachedActivity: CachedMyTracksActivityPolyline,
    jumpHeatPoints: JumpHeatPoint[],
  ): JumpHeatCollectionStats {
    return this.collectJumpHeatPoints(cachedActivity?.jumpHeatPoints || [], jumpHeatPoints);
  }

  private collectJumpHeatPoints(
    cachedJumpHeatPoints: CachedMyTracksJumpHeatPoint[],
    jumpHeatPoints: JumpHeatPoint[],
  ): JumpHeatCollectionStats {
    let jumpsWithCoordinates = 0;
    let jumpsWithWeightMetrics = 0;
    (cachedJumpHeatPoints || []).forEach((point) => {
      if (!this.isValidCachedJumpHeatPoint(point)) {
        return;
      }

      jumpsWithCoordinates++;
      if (point.hangTime === null && point.distance === null) {
        return;
      }

      jumpsWithWeightMetrics++;
      jumpHeatPoints.push({
        lng: point.lng,
        lat: point.lat,
        hangTime: point.hangTime,
        distance: point.distance,
      });
    });

    return {
      jumpsWithCoordinates,
      jumpsWithWeightMetrics
    };
  }

  private extractCachedJumpHeatPointsFromActivity(activity: any): CachedMyTracksJumpHeatPoint[] {
    const cachedJumpHeatPoints: CachedMyTracksJumpHeatPoint[] = [];
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
      cachedJumpHeatPoints.push({
        lng,
        lat,
        hangTime: this.getNumericJumpStatValue(jumpData?.hang_time),
        distance: this.getNumericJumpStatValue(jumpData?.distance),
      });
    });
    return cachedJumpHeatPoints;
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
      activityTypeValue: this.getActivityTypeValue(activity),
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

  private buildTrackStartPointFromCached(
    cachedActivity: CachedMyTracksActivityPolyline,
    eventId: string,
    startCoordinate: number[],
    startDateInput: number | Date | null | undefined,
  ): TrackStartPoint | null {
    if (!this.isCachedActivityMetadataComplete(cachedActivity)) {
      return null;
    }

    if (!Array.isArray(startCoordinate) || startCoordinate.length < 2) return null;
    const lng = Number(startCoordinate[0]);
    const lat = Number(startCoordinate[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;

    let startDate: number | null = null;
    if (typeof startDateInput === 'number' && Number.isFinite(startDateInput)) {
      startDate = startDateInput;
    } else if (startDateInput instanceof Date && Number.isFinite(startDateInput.getTime())) {
      startDate = startDateInput.getTime();
    }

    return {
      eventId: String(eventId),
      activityId: cachedActivity.activityId,
      activityType: cachedActivity.activityTypeLabel,
      activityTypeValue: cachedActivity.activityTypeValue,
      durationValue: cachedActivity.durationValue,
      distanceValue: cachedActivity.distanceValue,
      startDate,
      durationLabel: cachedActivity.durationLabel,
      distanceLabel: cachedActivity.distanceLabel,
      effortLabel: cachedActivity.effortLabel || undefined,
      effortDisplayLabel: cachedActivity.effortDisplayLabel,
      effortStatType: cachedActivity.effortStatType || undefined,
      lng,
      lat,
    };
  }

  private getActivityTypeValue(activity: any): ActivityTypes | string | number | null {
    const rawType = activity?.type;
    if (typeof rawType === 'string' && rawType.length > 0) return rawType;
    if (typeof rawType === 'number' && Number.isFinite(rawType)) return rawType;
    return null;
  }

  private resolveActivityTypeLabel(activity: any): string {
    const rawType = this.getActivityTypeValue(activity);
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

  private hasValidCoordinates(coordinates: number[][] | undefined): boolean {
    return Array.isArray(coordinates)
      && coordinates.length > 1
      && coordinates.every((coordinate) =>
        Array.isArray(coordinate)
        && coordinate.length >= 2
        && Number.isFinite(coordinate[0])
        && Number.isFinite(coordinate[1])
        && Math.abs(coordinate[0]) <= 180
        && Math.abs(coordinate[1]) <= 90
      );
  }

  private hasValidActivityTypeValue(value: string | number | null): boolean {
    return (typeof value === 'string' && value.trim().length > 0)
      || (typeof value === 'number' && Number.isFinite(value));
  }

  private isNullableNonNegativeNumber(value: number | null): boolean {
    return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
  }

  private isValidCachedJumpHeatPoint(point: CachedMyTracksJumpHeatPoint | undefined): boolean {
    return !!point
      && Number.isFinite(point.lng)
      && Number.isFinite(point.lat)
      && Math.abs(point.lng) <= 180
      && Math.abs(point.lat) <= 90
      && this.isNullableNonNegativeNumber(point.hangTime)
      && this.isNullableNonNegativeNumber(point.distance);
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
