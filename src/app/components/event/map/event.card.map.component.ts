import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
  effect,
  signal,
  untracked,
} from '@angular/core';
import { throttleTime } from 'rxjs/operators';
import {
  ActivityInterface,
  DataEvent,
  DataInterface,
  DataJumpEvent,
  DataLatitudeDegrees,
  DataLongitudeDegrees,
  DataPositionInterface,
  DynamicDataLoader,
  EventInterface,
  LapInterface,
  LapTypes,
  User
} from '@sports-alliance/sports-lib';
import { Subscription, asyncScheduler } from 'rxjs';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { AppUserUtilities } from '../../../utils/app.user.utilities';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { AppActivityCursorService } from '../../../services/activity-cursor/app-activity-cursor.service';
import { MapAbstractDirective } from '../../map/map-abstract.directive';
import { LoggerService } from '../../../services/logger.service';
import { MarkerFactoryService } from '../../../services/map/marker-factory.service';
import { MapboxLoaderService } from '../../../services/mapbox-loader.service';
import { MapStyleService } from '../../../services/map-style.service';
import { MapboxStyleSynchronizer } from '../../../services/map/mapbox-style-synchronizer';
import { AppMapStyleName } from '../../../models/app-user.interface';
import {
  correctPopupPositionToViewport,
  resolvePopupAnchorPosition
} from '../../../services/map/mapbox-popup-positioning.utils';
import {
  EventCardMapManager,
  EventCursorRenderData,
  EventTrackRenderData,
} from './event-card-map.manager';
import { isEventLapTypeAllowed } from '../../../helpers/event-lap-type.helper';

interface MapViewSettingsState {
  showLaps: boolean;
  showArrows: boolean;
  strokeWidth: number;
  mapStyle: AppMapStyleName;
  is3D: boolean;
}

@Component({
  selector: 'app-event-card-map',
  templateUrl: './event.card.map.component.html',
  styleUrls: ['./event.card.map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class EventCardMapComponent extends MapAbstractDirective implements OnChanges, OnInit, OnDestroy, AfterViewInit {
  public static readonly JUMP_MARKER_SIZE_BUCKETS = [18, 22, 26, 30, 34] as const;
  private static readonly JUMP_POPUP_OFFSET_PX = 14;
  private static readonly JUMP_POPUP_MARGIN_PX = 12;
  private static readonly JUMP_POPUP_WIDTH_ESTIMATE_PX = 260;
  private static readonly JUMP_POPUP_HEIGHT_ESTIMATE_PX = 220;

  @ViewChild('mapDiv', { static: false }) mapDiv!: ElementRef<HTMLDivElement>;
  @ViewChild('jumpPopupAnchor', { static: false }) jumpPopupAnchor?: ElementRef<HTMLDivElement>;
  @Input() event!: EventInterface;
  @Input() targetUserID!: string;
  @Input() user!: User;
  @Input() selectedActivities!: ActivityInterface[];

  private mapViewSettings = signal<MapViewSettingsState>({
    showLaps: true,
    showArrows: true,
    strokeWidth: 2,
    mapStyle: 'default',
    is3D: false,
  });

  public get showLaps() { return this.mapViewSettings().showLaps; }
  public set showLaps(value: boolean) {
    this.mapViewSettings.update(settings => ({ ...settings, showLaps: value }));
    this.userSettingsQuery.updateMapSettings({ showLaps: value });
  }

  public get showArrows() { return this.mapViewSettings().showArrows; }
  public set showArrows(value: boolean) {
    this.mapViewSettings.update(settings => ({ ...settings, showArrows: value }));
    this.userSettingsQuery.updateMapSettings({ showArrows: value });
  }

  public get strokeWidth() { return this.mapViewSettings().strokeWidth; }
  public set strokeWidth(value: number) {
    this.mapViewSettings.update(settings => ({ ...settings, strokeWidth: value }));
    this.userSettingsQuery.updateMapSettings({ strokeWidth: value });
  }

  public get mapStyle(): AppMapStyleName {
    return this.mapViewSettings().mapStyle;
  }
  public set mapStyle(value: AppMapStyleName) {
    this.mapViewSettings.update(settings => ({ ...settings, mapStyle: value }));
    this.userSettingsQuery.updateMapSettings({ mapStyle: value });
  }

  public get is3D(): boolean {
    return this.mapViewSettings().is3D;
  }
  public set is3D(value: boolean) {
    this.mapViewSettings.update(settings => ({ ...settings, is3D: value }));
    this.userSettingsQuery.updateMapSettings({ is3D: value });
  }

  public get lapTypes(): LapTypes[] {
    const types = (this._lapTypes && this._lapTypes.length > 0)
      ? this._lapTypes
      : (this.userSettingsQuery.chartSettings()?.lapTypes ?? AppUserUtilities.getDefaultChartLapTypes());
    return types;
  }
  @Input() set lapTypes(value: LapTypes[]) {
    this._lapTypes = value;
  }
  private _lapTypes: LapTypes[] = [];

  public activitiesMapData: MapData[] = [];
  public noMapData = false;

  public openedJumpMarkerInfoWindow: DataJumpEvent | undefined;
  public jumpPopupScreenPosition = signal<{ x: number; y: number } | null>(null);

  public apiLoaded = signal(false);

  private activitiesCursorSubscription: Subscription = new Subscription();

  private processSequence = 0;
  private previousState: any = {};
  private pendingFitBoundsTimeout: ReturnType<typeof setTimeout> | null = null;
  private deferredMapActivities: { shouldFitBounds: boolean; requestCount: number; lastReason: string } | null = null;
  private jumpHangTimeMin: number | null = null;
  private jumpHangTimeMax: number | null = null;

  private mapReady = false;
  private hasAppliedInitialBounds = false;
  private mapInstance = signal<any | null>(null);
  private mapStyleSynchronizer = signal<MapboxStyleSynchronizer | undefined>(undefined);
  private mapMoveRepositionHandler: (() => void) | null = null;
  private openedJumpCoordinates: { latitudeDegrees: number; longitudeDegrees: number } | null = null;
  private pendingJumpPopupCorrectionRaf: number | null = null;

  private mapManager: EventCardMapManager;

  constructor(
    private zone: NgZone,
    private changeDetectorRef: ChangeDetectorRef,
    private userSettingsQuery: AppUserSettingsQueryService,
    private activityCursorService: AppActivityCursorService,
    public eventColorService: AppEventColorService,
    private markerFactory: MarkerFactoryService,
    private mapboxLoader: MapboxLoaderService,
    private mapStyleService: MapStyleService,
    protected logger: LoggerService,
  ) {
    super(changeDetectorRef, logger);

    this.mapManager = new EventCardMapManager(this.markerFactory, this.logger);

    effect(() => {
      const map = this.mapInstance();
      const synchronizer = this.mapStyleSynchronizer();
      const mapStyle = this.mapStyle;
      const theme = this.appTheme();

      if (!map || !synchronizer) {
        return;
      }

      const resolvedStyle = this.mapStyleService.resolve(mapStyle, theme);
      this.logMapSettingsState('style-sync', {
        mapStyle,
        theme,
        resolvedStyle,
        is3D: this.is3D,
      });
      synchronizer.update(resolvedStyle);

      // Keep map marker popups correctly positioned when the projection changes.
      if (untracked(() => this.openedJumpMarkerInfoWindow)) {
        this.updateJumpPopupPosition();
      }
    });

    effect(() => {
      const remoteSettings = this.userSettingsQuery.mapSettings();
      const normalized = this.normalizeMapViewSettings(remoteSettings);
      const previous = untracked(() => this.mapViewSettings());
      const hasLayerSettingsDelta = previous.showLaps !== normalized.showLaps
        || previous.showArrows !== normalized.showArrows
        || previous.strokeWidth !== normalized.strokeWidth;
      const hasTerrainDelta = previous.is3D !== normalized.is3D;

      this.logMapSettingsState('settings-sync', {
        remoteSettings,
        previousLocalSettings: previous,
        normalizedSettings: normalized,
        hasLayerSettingsDelta,
        hasTerrainDelta,
        hasMapInstance: !!this.mapInstance(),
        mapReady: this.mapReady,
      });

      this.mapViewSettings.set(normalized);

      if (!this.mapInstance()) {
        return;
      }

      untracked(() => {
        if (hasLayerSettingsDelta && this.activitiesMapData.length) {
          this.logMapSettingsState('settings-sync: re-render map layers', {
            showLaps: normalized.showLaps,
            showArrows: normalized.showArrows,
            strokeWidth: normalized.strokeWidth,
            activitiesCount: this.activitiesMapData.length,
          });
          this.requestMapActivities(false, 'settings-sync');
        }
        if (hasTerrainDelta) {
          this.logMapSettingsState('settings-sync: apply terrain delta', {
            is3D: normalized.is3D,
          });
          this.mapManager.toggleTerrain(normalized.is3D, false);
        }
      });
    });

    effect(() => {
      const map = this.mapInstance();
      const theme = this.appTheme();

      if (!map || !this.activitiesMapData.length) {
        return;
      }

      this.logMapSettingsState('theme-sync: refresh track colors', {
        theme,
        activitiesCount: this.activitiesMapData.length,
      });

      untracked(() => {
        this.activitiesMapData = this.activitiesMapData.map((activityMapData) => ({
          ...activityMapData,
          strokeColor: this.resolveActivityStrokeColor(activityMapData.activity),
        }));
        this.renderMapData(false);
      });
    });
  }

  async ngOnInit() {
    if (!this.targetUserID || !this.event) {
      throw new Error('Component needs events and userID');
    }

    this.logMapSettingsState('ngOnInit', {
      remoteSettings: this.userSettingsQuery.mapSettings(),
      localSettings: this.mapViewSettings(),
    });

    this.activitiesCursorSubscription.add(this.activityCursorService.cursors.pipe(
      throttleTime(1000, asyncScheduler, { leading: true, trailing: true })
    ).subscribe((cursors) => {
      cursors.filter(cursor => cursor.byChart === true).forEach(cursor => {
        const cursorActivityMapData = this.activitiesMapData.find(amd => (amd.activity.getID() || '') === cursor.activityID);
        if (cursorActivityMapData && cursorActivityMapData.positions.length > 0) {
          const position = cursorActivityMapData.positions.reduce((prev, curr) =>
            Math.abs(curr.time - cursor.time) < Math.abs(prev.time - cursor.time) ? curr : prev);

          if (position) {
            this.activitiesCursors.set(cursor.activityID, {
              latitudeDegrees: position.latitudeDegrees,
              longitudeDegrees: position.longitudeDegrees
            });

            const map = this.mapInstance();
            if (map?.panTo) {
              map.panTo([position.longitudeDegrees, position.latitudeDegrees], {
                animate: true,
                duration: 250,
                essential: true
              });
            }
          }
        }
      });

      this.pushCursorMarkersToMap();
      this.changeDetectorRef.detectChanges();
    }));
  }

  async ngAfterViewInit(): Promise<void> {
    await this.initializeMap();
  }

  ngOnChanges(_simpleChanges: SimpleChanges) {
    if (!this.event) return;

    const currentSelectedActivitiesIDs = (this.selectedActivities || []).map(a => a.getID()).sort().join(',');
    const currentEventID = this.event?.getID();
    const mapSettings = this.mapViewSettings();

    const currentState: any = {
      eventID: currentEventID,
      selectedActivitiesIDs: currentSelectedActivitiesIDs,
      showLaps: mapSettings?.showLaps,
      showArrows: mapSettings?.showArrows,
      strokeWidth: mapSettings?.strokeWidth,
      mapStyle: mapSettings?.mapStyle,
      is3D: mapSettings?.is3D,
      lapTypes: JSON.stringify(this.lapTypes)
    };

    const changes: any = {};
    const keysToCheck = Object.keys(currentState);

    keysToCheck.forEach(key => {
      if (currentState[key] !== this.previousState[key]) {
        changes[key] = { currentValue: currentState[key], previousValue: this.previousState[key] };
      }
    });

    if (Object.keys(changes).length > 0) {
      const shouldFitBounds = !!changes.selectedActivitiesIDs || !!changes.eventID;
      this.previousState = { ...this.previousState, ...currentState };
      this.requestMapActivities(shouldFitBounds, 'ngOnChanges');
    }
  }

  public activitiesCursors: Map<string, { latitudeDegrees: number, longitudeDegrees: number }> = new Map();

  public async onMapStyleChange(style: AppMapStyleName): Promise<void> {
    this.mapStyle = style;
  }

  onShowLapsChange(value: boolean) {
    this.showLaps = value;
    this.requestMapActivities(false, 'showLaps');
  }

  onShowArrowsChange(value: boolean) {
    this.showArrows = value;
    this.renderMapData(false);
  }

  onShow3DChange(value: boolean) {
    this.logMapSettingsState('3d-toggle:user-action', {
      value,
      previousLocalSettings: this.mapViewSettings(),
      remoteSettings: this.userSettingsQuery.mapSettings(),
      hasMapInstance: !!this.mapInstance(),
      mapReady: this.mapReady,
    });
    this.is3D = value;
    this.mapManager.toggleTerrain(value, true);
    this.logMapSettingsState('3d-toggle:applied', {
      value,
      localSettings: this.mapViewSettings(),
      remoteSettings: this.userSettingsQuery.mapSettings(),
    });
  }

  onJumpPopupDismiss() {
    this.closeJumpPopup();
  }

  getJumpMarkerOptions(jump: DataJumpEvent, color: string): { content: HTMLElement; title: string } {
    const data = jump.jumpData;
    const hangTimeDisplay = data.hang_time ? data.hang_time.getDisplayValue(false, true, true) : '-';
    const distanceDisplay = this.getJumpStatDisplay(data.distance);
    const heightDisplay = this.getJumpStatDisplay(data.height);
    const scoreDisplay = this.getJumpStatDisplay(data.score);
    const speedDisplay = this.getJumpStatDisplay(data.speed);
    const rotationsDisplay = this.getJumpStatDisplay(data.rotations);
    const stats = [
      `Distance: ${distanceDisplay}`,
      `Height: ${heightDisplay}`,
      `Score: ${scoreDisplay}`,
      `Hang Time: ${hangTimeDisplay}`,
      `Speed: ${speedDisplay}`,
      `Rotations: ${rotationsDisplay}`
    ].join('\n');

    return {
      content: this.markerFactory.createJumpMarker(color, this.getJumpMarkerSize(jump)),
      title: `Jump Stats:\n${stats}`,
    };
  }

  @HostListener('window:resize')
  onResize() {
    this.fitBoundsToActivities();
    this.updateJumpPopupPosition();
  }

  ngOnDestroy(): void {
    this.unSubscribeFromAll();

    if (this.pendingFitBoundsTimeout) {
      clearTimeout(this.pendingFitBoundsTimeout);
      this.pendingFitBoundsTimeout = null;
    }
    if (this.pendingJumpPopupCorrectionRaf !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.pendingJumpPopupCorrectionRaf);
      this.pendingJumpPopupCorrectionRaf = null;
    }

    this.unbindMapPopupListeners();
    this.mapManager.clearAll();

    const map = this.mapInstance();
    if (map?.remove) {
      map.remove();
    }
  }

  private async initializeMap(): Promise<void> {
    if (!this.mapDiv?.nativeElement || this.mapInstance()) {
      return;
    }

    const initializeStartedAt = this.nowMs();
    this.logger.log('[EventCardMapPerf] initializeMap:start', {
      selectedActivities: this.selectedActivities?.length || 0,
      hasExistingMap: !!this.mapInstance(),
    });

    try {
      const resolvedStyle = this.mapStyleService.resolve(this.mapStyle, this.appTheme());
      const initialCamera = this.resolveInitialCamera();
      const mapOptions: any = {
        center: initialCamera.center,
        zoom: initialCamera.zoom,
      };
      mapOptions.style = resolvedStyle.styleUrl;

      this.logMapSettingsState('initialize-map:start', {
        remoteSettings: this.userSettingsQuery.mapSettings(),
        localSettings: this.mapViewSettings(),
        initialCamera,
        resolvedStyle,
      });

      if (this.mapStyleService.isStandard(resolvedStyle.styleUrl) && resolvedStyle.preset) {
        mapOptions.config = { basemap: { lightPreset: resolvedStyle.preset } };
      }

      const createMapStartedAt = this.nowMs();
      const map = await this.mapboxLoader.createMap(this.mapDiv.nativeElement, mapOptions);
      this.logPerformance('initializeMap:createMap', createMapStartedAt, {
        resolvedStyleValue: resolvedStyle.styleUrl,
      });

      const loadMapboxStartedAt = this.nowMs();
      const mapboxgl = await this.mapboxLoader.loadMapbox();
      this.logPerformance('initializeMap:loadMapbox', loadMapboxStartedAt);

      this.mapManager.setMap(map, mapboxgl);
      this.mapManager.setJumpClickHandler((jump, latitudeDegrees, longitudeDegrees) => {
        this.zone.run(() => this.openJumpMarkerInfoWindow(jump, latitudeDegrees, longitudeDegrees));
      });

      map.addControl(new mapboxgl.FullscreenControl(), 'bottom-right');
      map.addControl(new mapboxgl.NavigationControl({
        visualizePitch: true,
        showCompass: true,
        showZoom: true
      }), 'bottom-right');
      map.addControl(new mapboxgl.ScaleControl({
        maxWidth: 100,
        unit: 'metric'
      }), 'bottom-left');

      let styleReadyHandled = false;
      const applyInitialMapState = (source: 'style.load' | 'load') => {
        if (styleReadyHandled) {
          return;
        }
        styleReadyHandled = true;
        this.logPerformance('initializeMap:styleReady', initializeStartedAt, {
          source,
          activitiesPrepared: this.activitiesMapData.length,
        });
        this.logMapSettingsState(`map-${source}`, {
          remoteSettings: this.userSettingsQuery.mapSettings(),
          localSettings: this.mapViewSettings(),
          applyingTerrain: this.is3D,
        });
        this.mapReady = true;
        const flushedDeferred = this.flushDeferredMapActivities(`styleReady:${source}`);
        if (!flushedDeferred) {
          this.renderMapData(true);
        }
        this.mapManager.toggleTerrain(this.is3D, false);
        this.apiLoaded.set(true);
        this.changeDetectorRef.markForCheck();
      };

      map.on('style.load', () => {
        this.zone.run(() => applyInitialMapState('style.load'));
      });

      map.on('load', () => {
        this.zone.run(() => {
          this.logPerformance('initializeMap:mapLoadEvent', initializeStartedAt, {
            activitiesPrepared: this.activitiesMapData.length,
          });
          applyInitialMapState('load');
        });
      });

      map.on('click', () => {
        this.zone.run(() => this.closeJumpPopup());
      });

      this.mapInstance.set(map);
      this.mapStyleSynchronizer.set(this.mapStyleService.createSynchronizer(map));
      this.bindMapPopupListeners(map);

      this.requestMapActivities(true, 'initializeMap');
      this.logPerformance('initializeMap:queuedMapActivities', initializeStartedAt, {
        processSequence: this.processSequence,
        deferredRequests: this.deferredMapActivities?.requestCount || 0,
      });
    } catch (error) {
      this.logger.error('Failed to initialize EventCard Mapbox map.', error);
      this.noMapData = true;
      this.apiLoaded.set(true);
      this.changeDetectorRef.markForCheck();
    }
  }

  private mapActivities(sequence: number, shouldFitBounds = true) {
    const mapActivitiesStartedAt = this.nowMs();
    if (this.processSequence !== sequence) {
      this.logger.log('[EventCardMapPerf] mapActivities:staleSequenceSkipped', {
        expectedSequence: this.processSequence,
        receivedSequence: sequence,
      });
      return;
    }

    this.logger.log('[EventCardMapPerf] mapActivities:start', {
      sequence,
      shouldFitBounds,
      selectedActivities: this.selectedActivities?.length || 0,
    });

    this.loading();
    this.noMapData = false;
    this.activitiesMapData = [];
    this.jumpHangTimeMin = null;
    this.jumpHangTimeMax = null;

    if (!this.selectedActivities?.length) {
      this.noMapData = true;
      this.mapManager.renderActivities([], {
        showArrows: this.showArrows,
        strokeWidth: this.strokeWidth || 3,
      });
      this.loaded();
      this.logPerformance('mapActivities:noSelectedActivities', mapActivitiesStartedAt, { sequence });
      return;
    }

    let activitiesProcessed = 0;
    let activitiesWithPositions = 0;
    let totalPositions = 0;
    let totalLaps = 0;
    let totalJumps = 0;

    this.selectedActivities.forEach((activity) => {
      activitiesProcessed++;
      if (!activity.hasPositionData()) return;
      activitiesWithPositions++;

      const positionData = activity.getSquashedPositionData();
      const indexedPositionData = activity.getPositionData?.() || [];
      const positions = activity.generateTimeStream([DataLatitudeDegrees.type, DataLongitudeDegrees.type])
        .getData(true)
        .reduce<PositionWithTime[]>((positionWithTimeArray, time, index) => {
          const pos = positionData[index];
          if (pos && pos.latitudeDegrees !== undefined && pos.longitudeDegrees !== undefined && time !== null) {
            positionWithTimeArray.push({
              time: activity.startDate.getTime() + time * 1000,
              latitudeDegrees: pos.latitudeDegrees,
              longitudeDegrees: pos.longitudeDegrees
            });
          }
          return positionWithTimeArray;
        }, []);

      const lapCandidates = activity.getLaps().map((lap, lapIndex) => {
        const lapPositionData = activity.getSquashedPositionData(lap.startDate, lap.endDate);
        const indexedLapPosition = this.resolveLapPositionByIndex(indexedPositionData, lap, activity);
        return {
          lapIndex,
          lap,
          lapPositionData,
          indexedLapPosition,
          allowed: isEventLapTypeAllowed(lap.type, this.lapTypes),
        };
      });

      const laps = lapCandidates.reduce<MapData['laps']>((lapsArray, candidate) => {
        if (!candidate.lapPositionData.length || !this.showLaps) return lapsArray;
        if (!candidate.allowed) return lapsArray;
        lapsArray.push({
          lap: candidate.lap,
          lapPosition: {
            latitudeDegrees: candidate.indexedLapPosition?.latitudeDegrees
              || candidate.lapPositionData[candidate.lapPositionData.length - 1]?.latitudeDegrees
              || 0,
            longitudeDegrees: candidate.indexedLapPosition?.longitudeDegrees
              || candidate.lapPositionData[candidate.lapPositionData.length - 1]?.longitudeDegrees
              || 0
          }
        });
        return lapsArray;
      }, []);

      const jumps = (activity.getAllEvents() || []).reduce<any[]>((jumpsArray, event: DataEvent) => {
        if (event instanceof DataJumpEvent && event.jumpData.position_lat && event.jumpData.position_long) {
          jumpsArray.push({
            event,
            position: {
              latitudeDegrees: event.jumpData.position_lat.getValue(),
              longitudeDegrees: event.jumpData.position_long.getValue()
            }
          });
        }
        return jumpsArray;
      }, []);

      totalPositions += positions.length;
      totalLaps += laps.length;
      totalJumps += jumps.length;

      this.activitiesMapData.push({
        activity,
        positions,
        strokeColor: this.resolveActivityStrokeColor(activity),
        laps,
        jumps
      });
    });

    const hasRenderableMapData = this.activitiesMapData.some((data) => data.positions.length > 0);
    if (!hasRenderableMapData) {
      this.noMapData = true;
      this.mapManager.renderActivities([], {
        showArrows: this.showArrows,
        strokeWidth: this.strokeWidth || 3,
      });
      this.loaded();
      this.logPerformance('mapActivities:noRenderableData', mapActivitiesStartedAt, {
        sequence,
        activitiesProcessed,
        activitiesWithPositions,
      });
      return;
    }

    this.updateJumpHangTimeRange();
    this.renderMapData(shouldFitBounds);
    this.loaded();
    this.logPerformance('mapActivities:complete', mapActivitiesStartedAt, {
      sequence,
      activitiesProcessed,
      activitiesWithPositions,
      totalPositions,
      totalLaps,
      totalJumps,
      mappedActivities: this.activitiesMapData.length,
    });
  }

  private renderMapData(shouldFitBounds: boolean) {
    const renderStartedAt = this.nowMs();
    if (!this.mapReady || !this.mapInstance()) {
      this.logger.log('[EventCardMapPerf] renderMapData:skipped', {
        mapReady: this.mapReady,
        hasMapInstance: !!this.mapInstance(),
        shouldFitBounds,
      });
      return;
    }

    const tracksBuildStartedAt = this.nowMs();
    const tracks: EventTrackRenderData[] = this.activitiesMapData.map((activityMapData) => ({
      activityId: activityMapData.activity.getID() || '',
      strokeColor: activityMapData.strokeColor,
      positions: activityMapData.positions,
      laps: activityMapData.laps.map((lap, index) => ({
        lapIndex: index,
        latitudeDegrees: lap.lapPosition.latitudeDegrees,
        longitudeDegrees: lap.lapPosition.longitudeDegrees,
      })),
      jumps: activityMapData.jumps.map((jump) => ({
        event: jump.event,
        latitudeDegrees: jump.position.latitudeDegrees,
        longitudeDegrees: jump.position.longitudeDegrees,
        markerSize: this.getJumpMarkerSize(jump.event),
      }))
    }));
    const tracksBuildDuration = this.nowMs() - tracksBuildStartedAt;

    const managerRenderStartedAt = this.nowMs();
    this.mapManager.renderActivities(tracks, {
      showArrows: this.showArrows,
      strokeWidth: this.strokeWidth || 3,
    });
    const managerRenderDuration = this.nowMs() - managerRenderStartedAt;

    this.pushCursorMarkersToMap();
    this.logPerformance('renderMapData:complete', renderStartedAt, {
      tracks: tracks.length,
      shouldFitBounds,
      tracksBuildDurationMs: Math.round(tracksBuildDuration * 10) / 10,
      managerRenderDurationMs: Math.round(managerRenderDuration * 10) / 10,
    });

    if (shouldFitBounds) {
      if (this.pendingFitBoundsTimeout) {
        clearTimeout(this.pendingFitBoundsTimeout);
      }
      this.logger.log('[EventCardMapPerf] renderMapData:fitBoundsScheduled', {
        delayMs: 250,
        hasAppliedInitialBounds: this.hasAppliedInitialBounds,
      });
      this.pendingFitBoundsTimeout = setTimeout(() => {
        this.pendingFitBoundsTimeout = null;
        this.fitBoundsToActivities();
      }, 250);
    }
  }

  private fitBoundsToActivities() {
    const fitBoundsStartedAt = this.nowMs();
    if (!this.mapReady || !this.activitiesMapData.length) {
      this.logger.log('[EventCardMapPerf] fitBoundsToActivities:skipped', {
        mapReady: this.mapReady,
        activitiesMapDataLength: this.activitiesMapData.length,
      });
      return;
    }

    const animate = this.hasAppliedInitialBounds;
    const didFit = this.mapManager.fitBoundsToTracks(animate);
    if (didFit) {
      this.hasAppliedInitialBounds = true;
    }
    this.logPerformance('fitBoundsToActivities:complete', fitBoundsStartedAt, {
      animate,
      didFit,
      hasAppliedInitialBounds: this.hasAppliedInitialBounds,
      activitiesMapDataLength: this.activitiesMapData.length,
    });
  }

  private pushCursorMarkersToMap() {
    const cursors: EventCursorRenderData[] = this.activitiesMapData
      .map((data) => {
        const activityId = data.activity.getID() || '';
        const cursor = this.activitiesCursors.get(activityId);
        if (!cursor) {
          return null;
        }

        return {
          activityId,
          latitudeDegrees: cursor.latitudeDegrees,
          longitudeDegrees: cursor.longitudeDegrees,
          color: data.strokeColor,
        } as EventCursorRenderData;
      })
      .filter((cursor): cursor is EventCursorRenderData => !!cursor);

    this.mapManager.setCursorMarkers(cursors);
  }

  private openJumpMarkerInfoWindow(jump: DataJumpEvent, latitudeDegrees: number, longitudeDegrees: number) {
    this.openedJumpMarkerInfoWindow = jump;
    this.openedJumpCoordinates = { latitudeDegrees, longitudeDegrees };
    this.updateJumpPopupPosition();
    this.changeDetectorRef.markForCheck();
  }

  private closeJumpPopup() {
    this.openedJumpMarkerInfoWindow = void 0;
    this.openedJumpCoordinates = null;
    this.jumpPopupScreenPosition.set(null);
    this.changeDetectorRef.markForCheck();
  }

  private bindMapPopupListeners(map: any): void {
    this.unbindMapPopupListeners();

    if (!map?.on) {
      return;
    }

    this.mapMoveRepositionHandler = () => {
      if (!this.openedJumpMarkerInfoWindow) {
        return;
      }
      this.zone.run(() => this.updateJumpPopupPosition());
    };

    ['move', 'zoom', 'rotate', 'pitch', 'resize'].forEach((eventName) => {
      map.on(eventName, this.mapMoveRepositionHandler);
    });
  }

  private unbindMapPopupListeners(): void {
    if (!this.mapMoveRepositionHandler) {
      return;
    }

    const map = this.mapInstance();
    if (!map?.off) {
      return;
    }

    ['move', 'zoom', 'rotate', 'pitch', 'resize'].forEach((eventName) => {
      map.off(eventName, this.mapMoveRepositionHandler);
    });

    this.mapMoveRepositionHandler = null;
  }

  private updateJumpPopupPosition(): void {
    if (!this.openedJumpCoordinates || !this.openedJumpMarkerInfoWindow) {
      this.jumpPopupScreenPosition.set(null);
      return;
    }

    const screen = this.mapManager.project(
      this.openedJumpCoordinates.latitudeDegrees,
      this.openedJumpCoordinates.longitudeDegrees
    );
    const clamped = resolvePopupAnchorPosition(screen, this.mapDiv?.nativeElement, {
      preferredWidthPx: EventCardMapComponent.JUMP_POPUP_WIDTH_ESTIMATE_PX,
      preferredHeightPx: EventCardMapComponent.JUMP_POPUP_HEIGHT_ESTIMATE_PX,
      marginPx: EventCardMapComponent.JUMP_POPUP_MARGIN_PX,
      offsetPx: EventCardMapComponent.JUMP_POPUP_OFFSET_PX,
      minWidthPx: 140,
      minHeightPx: 120,
      preferAbove: true,
    });
    if (!clamped) {
      this.jumpPopupScreenPosition.set(null);
      return;
    }
    this.jumpPopupScreenPosition.set(clamped);
    this.scheduleJumpPopupViewportCorrection();
  }

  private scheduleJumpPopupViewportCorrection(): void {
    if (this.pendingJumpPopupCorrectionRaf !== null || typeof requestAnimationFrame !== 'function') {
      return;
    }

    this.pendingJumpPopupCorrectionRaf = requestAnimationFrame(() => {
      this.pendingJumpPopupCorrectionRaf = null;
      this.correctJumpPopupPositionWithMeasuredSize();
    });
  }

  private correctJumpPopupPositionWithMeasuredSize(): void {
    const anchor = this.jumpPopupAnchor?.nativeElement;
    const mapElement = this.mapDiv?.nativeElement;
    const current = this.jumpPopupScreenPosition();
    if (!anchor || !mapElement || !current || !this.openedJumpMarkerInfoWindow) {
      return;
    }

    const corrected = correctPopupPositionToViewport(
      current,
      mapElement,
      anchor,
      EventCardMapComponent.JUMP_POPUP_MARGIN_PX
    );
    if (corrected) {
      this.jumpPopupScreenPosition.set(corrected);
    }
  }

  private updateJumpHangTimeRange() {
    const hangTimes = this.activitiesMapData
      .flatMap(data => data.jumps)
      .map(jump => this.getJumpHangTime(jump.event))
      .filter((value): value is number => value !== null);

    if (!hangTimes.length) {
      this.jumpHangTimeMin = null;
      this.jumpHangTimeMax = null;
      return;
    }

    this.jumpHangTimeMin = Math.min(...hangTimes);
    this.jumpHangTimeMax = Math.max(...hangTimes);
  }

  private getJumpHangTime(jump: DataJumpEvent): number | null {
    const raw = jump?.jumpData?.hang_time?.getValue();
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  }

  private getPreferredUnitStat(stat: DataInterface | null | undefined): DataInterface | null {
    if (!stat) {
      return null;
    }

    try {
      const convertedStats = DynamicDataLoader.getUnitBasedDataFromDataInstance(
        stat,
        this.userSettingsQuery.unitSettings()
      );
      return convertedStats?.[0] ?? stat;
    } catch {
      return stat;
    }
  }

  private getJumpStatDisplay(stat: DataInterface | null | undefined): string {
    const preferredStat = this.getPreferredUnitStat(stat);
    if (!preferredStat) {
      return '-';
    }

    return `${preferredStat.getDisplayValue()} ${preferredStat.getDisplayUnit()}`.trim();
  }

  private getJumpMarkerSize(jump: DataJumpEvent): number {
    const buckets = EventCardMapComponent.JUMP_MARKER_SIZE_BUCKETS;
    const hangTime = this.getJumpHangTime(jump);

    if (hangTime === null || this.jumpHangTimeMin === null || this.jumpHangTimeMax === null) {
      return buckets[0];
    }

    if (this.jumpHangTimeMin === this.jumpHangTimeMax) {
      return buckets[Math.floor(buckets.length / 2)];
    }

    const normalized = (hangTime - this.jumpHangTimeMin) / (this.jumpHangTimeMax - this.jumpHangTimeMin);
    const bucketIndex = Math.min(
      buckets.length - 1,
      Math.max(0, Math.floor(normalized * buckets.length))
    );

    return buckets[bucketIndex];
  }

  private normalizeMapViewSettings(settings: any): MapViewSettingsState {
    return {
      showLaps: settings?.showLaps ?? true,
      showArrows: settings?.showArrows ?? true,
      strokeWidth: settings?.strokeWidth ?? 2,
      mapStyle: (settings?.mapStyle as AppMapStyleName) || 'default',
      is3D: settings?.is3D === true,
    };
  }

  private resolveActivityStrokeColor(activity: ActivityInterface): string {
    const fallbackColor = '#2ca3ff';
    const baseColor = this.sanitizeStrokeColor(
      this.eventColorService.getActivityColor(this.event.getActivities(), activity),
      fallbackColor
    );
    const adjustedColor = this.mapStyleService.adjustColorForTheme(baseColor, this.appTheme());
    return this.sanitizeStrokeColor(adjustedColor, fallbackColor);
  }

  private sanitizeStrokeColor(color: unknown, fallbackColor: string): string {
    if (typeof color !== 'string') {
      return fallbackColor;
    }

    const trimmed = color.trim();
    if (trimmed.length === 0) {
      return fallbackColor;
    }

    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
      return trimmed;
    }

    const keyword = trimmed.toLowerCase();
    if (keyword === 'black') {
      return '#000000';
    }
    if (keyword === 'white') {
      return '#ffffff';
    }

    return fallbackColor;
  }

  private resolveInitialCamera(): { center: [number, number]; zoom: number } {
    const firstPosition = (this.selectedActivities || [])
      .filter((activity) => activity.hasPositionData())
      .map((activity) => activity.getSquashedPositionData()?.[0])
      .find((position) =>
        position
        && Number.isFinite(position.latitudeDegrees)
        && Number.isFinite(position.longitudeDegrees)
      );

    if (firstPosition) {
      return {
        center: [firstPosition.longitudeDegrees, firstPosition.latitudeDegrees],
        zoom: 12,
      };
    }

    return {
      center: [0, 0],
      zoom: 2,
    };
  }

  private logMapSettingsState(stage: string, state: Record<string, unknown>): void {
    this.logger.log(`[EventCardMapComponent] ${stage}`, state);
  }

  private nowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  private logPerformance(stage: string, startedAt: number, state: Record<string, unknown> = {}): void {
    const durationMs = Math.round((this.nowMs() - startedAt) * 10) / 10;
    this.logger.log(`[EventCardMapPerf] ${stage}`, {
      durationMs,
      ...state,
    });
  }

  private unSubscribeFromAll() {
    if (this.activitiesCursorSubscription) {
      this.activitiesCursorSubscription.unsubscribe();
    }
  }

  private requestMapActivities(shouldFitBounds: boolean, reason: string): void {
    if (!this.mapReady) {
      const previous = this.deferredMapActivities;
      this.deferredMapActivities = {
        shouldFitBounds: (previous?.shouldFitBounds || false) || shouldFitBounds,
        requestCount: (previous?.requestCount || 0) + 1,
        lastReason: reason,
      };
      this.logger.log('[EventCardMapPerf] mapActivities:deferred', {
        reason,
        shouldFitBounds,
        mergedShouldFitBounds: this.deferredMapActivities.shouldFitBounds,
        requestCount: this.deferredMapActivities.requestCount,
        hasMapInstance: !!this.mapInstance(),
        mapReady: this.mapReady,
      });
      return;
    }

    this.mapActivities(++this.processSequence, shouldFitBounds);
  }

  private flushDeferredMapActivities(reason: string): boolean {
    const deferred = this.deferredMapActivities;
    if (!deferred) {
      return false;
    }

    this.deferredMapActivities = null;
    this.logger.log('[EventCardMapPerf] mapActivities:flushDeferred', {
      reason,
      shouldFitBounds: deferred.shouldFitBounds,
      requestCount: deferred.requestCount,
      lastReason: deferred.lastReason,
    });
    this.mapActivities(++this.processSequence, deferred.shouldFitBounds);
    return true;
  }

  private resolveLapPositionByIndex(
    positionData: Array<DataPositionInterface | null>,
    lap: LapInterface,
    activity: ActivityInterface
  ): DataPositionInterface | null {
    if (typeof lap.getEndIndex !== 'function' || !positionData.length) {
      return null;
    }

    const endIndex = lap.getEndIndex(activity);
    if (!Number.isFinite(endIndex)) {
      return null;
    }

    const clampedIndex = Math.min(positionData.length - 1, Math.max(0, Math.trunc(endIndex)));
    for (let index = clampedIndex; index >= 0; index -= 1) {
      const position = positionData[index];
      if (position?.latitudeDegrees !== undefined && position?.longitudeDegrees !== undefined) {
        return position;
      }
    }

    for (let index = clampedIndex + 1; index < positionData.length; index += 1) {
      const position = positionData[index];
      if (position?.latitudeDegrees !== undefined && position?.longitudeDegrees !== undefined) {
        return position;
      }
    }

    return null;
  }
}

export interface MapData {
  activity: ActivityInterface;
  positions: PositionWithTime[];
  strokeColor: string;
  laps: {
    lap: LapInterface,
    lapPosition: { latitudeDegrees: number, longitudeDegrees: number, time?: number },
    symbol?: any,
  }[];
  jumps: {
    event: DataJumpEvent,
    position: { latitudeDegrees: number, longitudeDegrees: number }
  }[];
}

export interface PositionWithTime {
  latitudeDegrees: number;
  longitudeDegrees: number;
  time: number;
}
