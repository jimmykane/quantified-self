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
  SimpleChanges,
  ViewChild,
  effect,
  signal,
  untracked,
} from '@angular/core';
import { User } from '@sports-alliance/sports-lib';
import { AppMapStyleName } from '../../../models/app-user.interface';
import { SharedModule } from '../../../modules/shared.module';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { LoggerService } from '../../../services/logger.service';
import { MarkerFactoryService } from '../../../services/map/marker-factory.service';
import { MapboxAutoResizeService } from '../../../services/map/mapbox-auto-resize.service';
import { MapboxStyleSynchronizer } from '../../../services/map/mapbox-style-synchronizer';
import { isStyleReady } from '../../../services/map/mapbox-style-ready.utils';
import {
  hasTrackMapLayerSettingsDelta,
  normalizeTrackMapViewSettings,
  resolveTrackMapInitialCamera,
  TrackMapViewSettingsState,
} from '../../../services/map/track-map-view-state.helper';
import { MapboxLoaderService } from '../../../services/mapbox-loader.service';
import { MapStyleService } from '../../../services/map-style.service';
import { TrackMapManager, TrackMapRenderData } from '../../../services/map/track-map.manager';
import { MapAbstractDirective } from '../../map/map-abstract.directive';
import { RouteSegmentDetailView, RouteWaypointDisplayView } from '../../../helpers/route-detail.helper';
import { buildRouteMapSegmentRenderData, RouteMapWaypointRenderData } from '../../../helpers/route-map.helper';

const ROUTE_ENDPOINT_MARKER_TRACK_LIMIT = 24;

@Component({
  selector: 'app-route-map',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './route-map.component.html',
  styleUrls: ['./route-map.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RouteMapComponent extends MapAbstractDirective implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('mapDiv', { static: false }) mapDiv!: ElementRef<HTMLDivElement>;

  @Input() segments: RouteSegmentDetailView[] = [];
  @Input() waypoints: RouteWaypointDisplayView[] = [];
  @Input() user: User | null = null;

  public apiLoaded = signal(false);
  public noMapData = false;

  private mapViewSettings = signal<TrackMapViewSettingsState>({
    showArrows: true,
    strokeWidth: 2,
    mapStyle: 'default',
    is3D: false,
  });

  public get showArrows() { return this.mapViewSettings().showArrows; }
  public set showArrows(value: boolean) {
    this.mapViewSettings.update(settings => ({ ...settings, showArrows: value }));
    void this.userSettingsQuery.updateMapSettings({ showArrows: value });
  }

  public get strokeWidth() { return this.mapViewSettings().strokeWidth; }
  public set strokeWidth(value: number) {
    this.mapViewSettings.update(settings => ({ ...settings, strokeWidth: value }));
    void this.userSettingsQuery.updateMapSettings({ strokeWidth: value });
  }

  public get mapStyle(): AppMapStyleName {
    return this.mapViewSettings().mapStyle;
  }
  public set mapStyle(value: AppMapStyleName) {
    this.mapViewSettings.update(settings => ({ ...settings, mapStyle: value }));
    void this.userSettingsQuery.updateMapSettings({ mapStyle: value });
  }

  public get is3D(): boolean {
    return this.mapViewSettings().is3D;
  }
  public set is3D(value: boolean) {
    this.mapViewSettings.update(settings => ({ ...settings, is3D: value }));
    void this.userSettingsQuery.updateMapSettings({ is3D: value });
  }

  private mapManager: TrackMapManager;
  private mapReady = false;
  private hasAppliedInitialBounds = false;
  private mapInstance = signal<any | null>(null);
  private mapStyleSynchronizer = signal<MapboxStyleSynchronizer | undefined>(undefined);
  private pendingFitBoundsTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingMapInitTimeout: ReturnType<typeof setTimeout> | null = null;
  private mapInitResizeObserver: ResizeObserver | null = null;
  private destroyed = false;

  constructor(
    private zone: NgZone,
    private changeDetectorRef: ChangeDetectorRef,
    private userSettingsQuery: AppUserSettingsQueryService,
    private markerFactory: MarkerFactoryService,
    private mapboxLoader: MapboxLoaderService,
    private mapboxAutoResizeService: MapboxAutoResizeService,
    private mapStyleService: MapStyleService,
    protected logger: LoggerService,
  ) {
    super(changeDetectorRef, logger);
    this.mapManager = new TrackMapManager(this.markerFactory, this.logger, {
      layerPrefix: 'route-track',
      logPrefix: 'RouteMapManager',
    });

    effect(() => {
      const remoteSettings = this.userSettingsQuery.mapSettings();
      const normalized = normalizeTrackMapViewSettings(remoteSettings);
      const previous = untracked(() => this.mapViewSettings());
      const hasLayerSettingsDelta = hasTrackMapLayerSettingsDelta(previous, normalized);
      const hasTerrainDelta = previous.is3D !== normalized.is3D;

      this.mapViewSettings.set(normalized);
      if (!this.mapInstance()) {
        return;
      }

      untracked(() => {
        if (hasLayerSettingsDelta) {
          this.renderRouteData(false);
        }
        if (hasTerrainDelta) {
          this.mapManager.toggleTerrain(normalized.is3D, false);
        }
      });
    });

    effect(() => {
      const map = this.mapInstance();
      const synchronizer = this.mapStyleSynchronizer();
      const mapStyle = this.mapStyle;
      const theme = this.appTheme();

      if (!map || !synchronizer) {
        return;
      }

      const resolvedStyle = this.mapStyleService.resolve(mapStyle, theme);
      synchronizer.update(resolvedStyle);
    });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.initializeMap();
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.renderRouteData(true);
  }

  @HostListener('window:resize')
  onResize(): void {
    this.fitBoundsToRoutes();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.pendingFitBoundsTimeout) {
      clearTimeout(this.pendingFitBoundsTimeout);
      this.pendingFitBoundsTimeout = null;
    }
    this.cancelPendingMapInitialization();
    this.mapManager.clearAll();
    const map = this.mapInstance();
    this.mapboxAutoResizeService.unbind(map);
    if (map?.remove) {
      map.remove();
    }
  }

  public async onMapStyleChange(style: AppMapStyleName): Promise<void> {
    this.mapStyle = style;
  }

  public onShowArrowsChange(value: boolean): void {
    this.showArrows = value;
    this.renderRouteData(false);
  }

  public onShow3DChange(value: boolean): void {
    this.is3D = value;
    this.mapManager.toggleTerrain(value, true);
  }

  private async initializeMap(): Promise<void> {
    if (!this.mapDiv?.nativeElement || this.mapInstance()) {
      return;
    }

    const mapElement = this.mapDiv.nativeElement;
    if (!this.hasRenderableMapContainer(mapElement)) {
      this.deferMapInitializationUntilContainerReady(mapElement);
      return;
    }

    try {
      const resolvedStyle = this.mapStyleService.resolve(this.mapStyle, this.appTheme());
      const initialCamera = this.resolveInitialCamera();
      const mapOptions: any = {
        center: initialCamera.center,
        zoom: initialCamera.zoom,
        style: resolvedStyle.styleUrl,
      };

      if (this.mapStyleService.isStandard(resolvedStyle.styleUrl) && resolvedStyle.preset) {
        mapOptions.config = { basemap: { lightPreset: resolvedStyle.preset } };
      }

      const map = await this.mapboxLoader.createMap(mapElement, mapOptions);
      const mapboxgl = await this.mapboxLoader.loadMapbox();
      this.mapManager.setMap(map, mapboxgl);
      this.mapboxAutoResizeService.bind(map, {
        container: mapElement,
        onResize: () => this.zone.run(() => this.fitBoundsToRoutes()),
        throttleMs: 150,
      });

      map.addControl(new mapboxgl.FullscreenControl(), 'bottom-right');
      map.addControl(new mapboxgl.NavigationControl({
        visualizePitch: true,
        showCompass: true,
        showZoom: true,
      }), 'bottom-right');
      map.addControl(new mapboxgl.ScaleControl({
        maxWidth: 100,
        unit: 'metric',
      }), 'bottom-left');

      const applyStyleReadyState = () => {
        if (!isStyleReady(map)) {
          return;
        }
        const wasReady = this.mapReady;
        this.mapReady = true;
        if (!wasReady) {
          this.renderRouteData(true);
          this.mapManager.toggleTerrain(this.is3D, false);
          this.apiLoaded.set(true);
          this.changeDetectorRef.markForCheck();
        }
      };

      ['style.load', 'style.import.load', 'styledata', 'idle', 'load'].forEach((eventName) => {
        map.on(eventName, () => this.zone.run(() => applyStyleReadyState()));
      });

      this.mapInstance.set(map);
      this.mapStyleSynchronizer.set(this.mapStyleService.createSynchronizer(map));
      applyStyleReadyState();
    } catch (error) {
      this.logger.error('[RouteMapComponent] Failed to initialize Mapbox map.', error);
      this.noMapData = true;
      this.apiLoaded.set(true);
      this.changeDetectorRef.markForCheck();
    }
  }

  private renderRouteData(shouldFitBounds: boolean): void {
    const map = this.mapInstance();
    if (!this.mapReady || !map || !isStyleReady(map)) {
      return;
    }

    const routeSegments = buildRouteMapSegmentRenderData(this.segments, this.waypoints);
    this.noMapData = routeSegments.length === 0;
    const tracks: TrackMapRenderData[] = routeSegments.map((segment) => ({
      id: segment.id,
      label: segment.label,
      strokeColor: this.mapStyleService.adjustColorForTheme(segment.color, this.appTheme()),
      positions: segment.positions,
      markers: segment.waypoints.map(waypoint => ({
        id: waypoint.id,
        latitudeDegrees: waypoint.latitudeDegrees,
        longitudeDegrees: waypoint.longitudeDegrees,
        element: this.createWaypointMarker(waypoint.color, waypoint),
      })),
    }));

    this.mapManager.renderTrackData(tracks, {
      showArrows: this.showArrows,
      showEndpointMarkers: tracks.length <= ROUTE_ENDPOINT_MARKER_TRACK_LIMIT,
      strokeWidth: this.strokeWidth || 3,
    });
    this.loaded();
    this.changeDetectorRef.markForCheck();

    if (shouldFitBounds) {
      this.scheduleFitBounds();
    }
  }

  private createWaypointMarker(color: string, waypoint: RouteMapWaypointRenderData): HTMLElement {
    const element = this.markerFactory.createPinMarker(color);
    element.title = [waypoint.name, waypoint.type, waypoint.distanceLabel].filter(Boolean).join('\n');
    element.setAttribute('aria-label', `Waypoint ${waypoint.name}`);
    return element;
  }

  private scheduleFitBounds(): void {
    if (this.pendingFitBoundsTimeout) {
      clearTimeout(this.pendingFitBoundsTimeout);
    }
    this.pendingFitBoundsTimeout = setTimeout(() => {
      this.pendingFitBoundsTimeout = null;
      this.fitBoundsToRoutes();
    }, 250);
  }

  private deferMapInitializationUntilContainerReady(mapElement: HTMLElement): void {
    if (this.pendingMapInitTimeout || this.mapInitResizeObserver) {
      return;
    }

    const tryInitialize = () => {
      if (this.destroyed || this.mapInstance()) {
        this.cancelPendingMapInitialization();
        return;
      }

      if (!this.hasRenderableMapContainer(mapElement)) {
        this.pendingMapInitTimeout = setTimeout(tryInitialize, 100);
        return;
      }

      this.cancelPendingMapInitialization();
      void this.initializeMap();
    };

    if (typeof ResizeObserver !== 'undefined') {
      this.mapInitResizeObserver = new ResizeObserver(() => tryInitialize());
      this.mapInitResizeObserver.observe(mapElement);
    }
    this.pendingMapInitTimeout = setTimeout(tryInitialize, 100);
  }

  private cancelPendingMapInitialization(): void {
    if (this.pendingMapInitTimeout) {
      clearTimeout(this.pendingMapInitTimeout);
      this.pendingMapInitTimeout = null;
    }
    if (this.mapInitResizeObserver) {
      this.mapInitResizeObserver.disconnect();
      this.mapInitResizeObserver = null;
    }
  }

  private hasRenderableMapContainer(mapElement: HTMLElement): boolean {
    const rect = mapElement.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  private fitBoundsToRoutes(): void {
    if (!this.mapReady) {
      return;
    }

    const animate = this.hasAppliedInitialBounds;
    const didFit = this.mapManager.fitBoundsToTracks(animate);
    if (didFit) {
      this.hasAppliedInitialBounds = true;
    }
  }

  private resolveInitialCamera(): { center: [number, number]; zoom: number } {
    return resolveTrackMapInitialCamera((this.segments || []).flatMap(segment => segment.positions || []));
  }
}
