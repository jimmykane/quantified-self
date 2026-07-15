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
  computed,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { User } from '@sports-alliance/sports-lib';
import type { FirestoreRouteJSON } from '@shared/app-route.interface';
import {
  buildRoutePreviewMapTracks,
  type RoutePreviewMapTrackMetadata,
} from '../../../helpers/route-preview-map.helper';
import { buildRouteSummaryMetrics } from '../../../helpers/route-detail.helper';
import { AppMapStyleName } from '../../../models/app-user.interface';
import { SharedModule } from '../../../modules/shared.module';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { LoggerService } from '../../../services/logger.service';
import { MarkerFactoryService } from '../../../services/map/marker-factory.service';
import { MapboxAutoResizeService } from '../../../services/map/mapbox-auto-resize.service';
import { MapboxStyleSynchronizer } from '../../../services/map/mapbox-style-synchronizer';
import { isStyleReady } from '../../../services/map/mapbox-style-ready.utils';
import { resolveTrackMapInitialCamera } from '../../../services/map/track-map-view-state.helper';
import { TrackMapClickEvent, TrackMapManager, TrackMapRenderData } from '../../../services/map/track-map.manager';
import { MapStyleName } from '../../../services/map/map-style.types';
import { MapStyleService } from '../../../services/map-style.service';
import { MapboxLoaderService } from '../../../services/mapbox-loader.service';
import { MapAbstractDirective } from '../../map/map-abstract.directive';
import { SummaryPrimaryInfoMetric } from '../../shared/summary-primary-info/summary-primary-info.component';

const ROUTE_PREVIEW_ENDPOINT_MARKER_TRACK_LIMIT = 24;
const ROUTE_PREVIEW_FIT_BOUNDS_DEBOUNCE_MS = 500;

@Component({
  selector: 'app-dashboard-route-preview-map',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './dashboard-route-preview-map.component.html',
  styleUrls: ['./dashboard-route-preview-map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardRoutePreviewMapComponent extends MapAbstractDirective implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('mapDiv', { static: false }) mapDiv?: ElementRef<HTMLDivElement>;

  @Input() routes: FirestoreRouteJSON[] = [];
  @Input() user?: User | null;
  @Input() showEndpointMarkers = true;

  @Input() set mapStyle(value: AppMapStyleName | MapStyleName | undefined) {
    this.mapStyleSignal.set(this.mapStyleService.normalizeStyle(value));
  }

  public get mapStyle(): MapStyleName {
    return this.mapStyleSignal();
  }

  public apiLoaded = signal(false);
  public mapLoadFailed = false;
  public noMapData = false;
  public selectedRoute = signal<FirestoreRouteJSON | null>(null);
  public selectedRouteMetrics = signal<SummaryPrimaryInfoMetric[]>([]);
  public selectedRouteTitle = computed(() => `${this.selectedRoute()?.name || 'Route'}`.trim() || 'Route');
  public selectedRouteDate = computed(() => this.resolveRouteDate(this.selectedRoute()));
  public selectedRouteSourceLabel = computed(() => this.resolveRouteSourceLabel(this.selectedRoute()));

  private readonly mapStyleSignal = signal<MapStyleName>('default');
  private readonly mapManager: TrackMapManager;
  private mapInstance = signal<any | null>(null);
  private mapStyleSynchronizer = signal<MapboxStyleSynchronizer | undefined>(undefined);
  private mapReady = false;
  private hasAppliedInitialBounds = false;
  private pendingFitBoundsTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingFitBoundsFingerprint: string | null = null;
  private lastAppliedFitBoundsFingerprint: string | null = null;
  private mapLifecycleHandlers: Array<{ eventName: string; handler: () => void }> = [];
  private destroyed = false;

  constructor(
    private zone: NgZone,
    private changeDetectorRef: ChangeDetectorRef,
    private markerFactory: MarkerFactoryService,
    private mapboxLoader: MapboxLoaderService,
    private mapboxAutoResizeService: MapboxAutoResizeService,
    private mapStyleService: MapStyleService,
    private router: Router,
    private analyticsService: AppAnalyticsService,
    protected logger: LoggerService,
  ) {
    super(changeDetectorRef, logger);
    this.mapManager = new TrackMapManager(this.markerFactory, this.logger, {
      layerPrefix: 'dashboard-route-preview',
      logPrefix: 'DashboardRoutePreviewMapManager',
    });

    effect(() => {
      const map = this.mapInstance();
      const synchronizer = this.mapStyleSynchronizer();
      const mapStyle = this.mapStyleSignal();
      const theme = this.appTheme();
      if (!map || !synchronizer) {
        return;
      }

      synchronizer.update(this.mapStyleService.resolve(mapStyle, theme));
      this.renderRoutePreviews(true);
      this.changeDetectorRef.markForCheck();
    });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.initializeMap();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.routes || changes.showEndpointMarkers) {
      this.renderRoutePreviews(!!changes.routes);
    }
  }

  public clearSelectedRoute(): void {
    this.selectedRoute.set(null);
    this.selectedRouteMetrics.set([]);
    this.changeDetectorRef.markForCheck();
  }

  public openSelectedRoute(): void {
    const route = this.selectedRoute();
    const routeID = `${route?.id || ''}`.trim();
    const userID = `${route?.userID || this.user?.uid || ''}`.trim();
    if (!routeID || !userID) {
      return;
    }

    this.analyticsService.logSavedRouteAction('open_details', {
      fileType: this.resolvePrimaryRouteFileType(route),
      source: 'dashboard_route_map',
    });
    void this.router.navigate(['/user', userID, 'route', routeID]);
  }

  @HostListener('window:resize')
  onResize(): void {
    this.fitBoundsToRoutes(false);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.pendingFitBoundsTimeout) {
      clearTimeout(this.pendingFitBoundsTimeout);
      this.pendingFitBoundsTimeout = null;
    }
    this.mapManager.clearAll();
    const map = this.mapInstance();
    this.mapboxAutoResizeService.unbind(map);
    this.detachMapLifecycleHandlers(map);
    if (map?.remove) {
      map.remove();
    }
    this.mapInstance.set(null);
    this.mapStyleSynchronizer.set(undefined);
  }

  private async initializeMap(): Promise<void> {
    if (!this.mapDiv?.nativeElement || this.mapInstance()) {
      return;
    }

    const mapElement = this.mapDiv.nativeElement;
    if (!this.hasRenderableMapContainer(mapElement)) {
      window.setTimeout(() => {
        if (!this.destroyed) {
          void this.initializeMap();
        }
      }, 100);
      return;
    }

    let createdMap: any | null = null;
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
      createdMap = map;
      if (this.destroyed) {
        if (map?.remove) {
          map.remove();
        }
        return;
      }
      const mapboxgl = await this.mapboxLoader.loadMapbox();
      if (this.destroyed) {
        if (map?.remove) {
          map.remove();
        }
        return;
      }
      this.mapManager.setMap(map, mapboxgl);
      this.mapboxAutoResizeService.bind(map, {
        container: mapElement,
        onResize: () => this.zone.run(() => this.fitBoundsToRoutes(false)),
        throttleMs: 150,
      });
      map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

      const applyReadyState = (rerenderWhenReady = false) => {
        if (!isStyleReady(map)) {
          return;
        }
        const wasReady = this.mapReady;
        if (wasReady && !rerenderWhenReady) {
          return;
        }
        if (!wasReady) {
          this.mapReady = true;
          this.apiLoaded.set(true);
        }
        this.renderRoutePreviews(true);
        this.changeDetectorRef.markForCheck();
      };

      [
        { eventName: 'style.load', rerenderWhenReady: true },
        { eventName: 'style.import.load', rerenderWhenReady: false },
        { eventName: 'styledata', rerenderWhenReady: false },
        { eventName: 'idle', rerenderWhenReady: false },
        { eventName: 'load', rerenderWhenReady: false },
      ].forEach(({ eventName, rerenderWhenReady }) => {
        const handler = () => this.zone.run(() => applyReadyState(rerenderWhenReady));
        this.mapLifecycleHandlers.push({ eventName, handler });
        map.on(eventName, handler);
      });

      this.mapInstance.set(map);
      this.mapStyleSynchronizer.set(this.mapStyleService.createSynchronizer(map, resolvedStyle));
      createdMap = null;
      applyReadyState();
    } catch (error) {
      this.cleanupFailedMapInitialization(createdMap || this.mapInstance());
      this.logger.error('[DashboardRoutePreviewMapComponent] Failed to initialize Mapbox map.', error);
      this.mapLoadFailed = true;
      this.apiLoaded.set(true);
      this.changeDetectorRef.markForCheck();
    }
  }

  private cleanupFailedMapInitialization(map: any | null): void {
    if (!map) {
      return;
    }
    if (this.pendingFitBoundsTimeout) {
      clearTimeout(this.pendingFitBoundsTimeout);
      this.pendingFitBoundsTimeout = null;
    }
    this.mapboxAutoResizeService.unbind(map);
    this.detachMapLifecycleHandlers(map);
    this.mapManager.clearAll();
    if (map?.remove) {
      map.remove();
    }
    if (this.mapInstance() === map) {
      this.mapInstance.set(null);
    }
    this.mapStyleSynchronizer.set(undefined);
    this.mapReady = false;
  }

  private renderRoutePreviews(shouldFitBounds: boolean): void {
    const map = this.mapInstance();
    if (!this.mapReady || !map || !isStyleReady(map)) {
      return;
    }

    const tracks = this.buildTracks();
    this.noMapData = tracks.length === 0;
    this.mapManager.renderTrackData(tracks, {
      showArrows: false,
      showEndpointMarkers: this.showEndpointMarkers !== false
        && tracks.length <= ROUTE_PREVIEW_ENDPOINT_MARKER_TRACK_LIMIT,
      endpointMarkerStyle: 'dots',
      strokeWidth: 2.75,
      onTrackClick: (event) => this.zone.run(() => this.selectRouteFromTrackClick(event)),
    });
    this.clearSelectedRouteIfMissing();
    this.changeDetectorRef.markForCheck();

    if (shouldFitBounds && tracks.length) {
      this.scheduleFitBounds(this.buildTrackBoundsFingerprint(tracks));
    }
  }

  private buildTracks(): TrackMapRenderData[] {
    return buildRoutePreviewMapTracks(this.routes)
      .map(track => ({
        ...track,
        strokeColor: this.mapStyleService.adjustColorForTheme(track.strokeColor, this.appTheme()),
      }));
  }

  private selectRouteFromTrackClick(event: TrackMapClickEvent): void {
    const routeId = this.getTrackRouteId(event.track);
    if (!routeId) {
      return;
    }
    const route = (this.routes || []).find(candidate => `${candidate?.id || ''}` === routeId);
    if (!route) {
      return;
    }

    this.selectedRoute.set(route);
    this.selectedRouteMetrics.set(this.buildPopupMetrics(route));
    this.changeDetectorRef.markForCheck();
  }

  private clearSelectedRouteIfMissing(): void {
    const selectedRouteID = `${this.selectedRoute()?.id || ''}`.trim();
    if (!selectedRouteID) {
      return;
    }
    const stillPresent = (this.routes || []).some(route => `${route?.id || ''}` === selectedRouteID);
    if (!stillPresent) {
      this.clearSelectedRoute();
    }
  }

  private getTrackRouteId(track: TrackMapRenderData | null | undefined): string {
    const metadata = track?.metadata as Partial<RoutePreviewMapTrackMetadata> | undefined;
    return typeof metadata?.routeId === 'string' ? metadata.routeId.trim() : '';
  }

  private buildPopupMetrics(route: FirestoreRouteJSON): SummaryPrimaryInfoMetric[] {
    return buildRouteSummaryMetrics(route, this.user?.settings?.unitSettings || null)
      .filter(metric => ['Distance', 'Ascent', 'Descent'].includes(metric.label))
      .slice(0, 3);
  }

  private scheduleFitBounds(fingerprint: string): void {
    if (fingerprint === this.lastAppliedFitBoundsFingerprint) {
      return;
    }
    if (this.pendingFitBoundsTimeout && this.pendingFitBoundsFingerprint === fingerprint) {
      return;
    }
    if (this.pendingFitBoundsTimeout) {
      clearTimeout(this.pendingFitBoundsTimeout);
    }
    this.pendingFitBoundsFingerprint = fingerprint;
    this.pendingFitBoundsTimeout = setTimeout(() => {
      this.pendingFitBoundsTimeout = null;
      this.pendingFitBoundsFingerprint = null;
      this.fitBoundsToRoutes(false, fingerprint);
    }, ROUTE_PREVIEW_FIT_BOUNDS_DEBOUNCE_MS);
  }

  private fitBoundsToRoutes(animate = false, fingerprint: string | null = null): void {
    if (!this.mapReady) {
      return;
    }
    const didFit = this.mapManager.fitBoundsToTracks(animate && this.hasAppliedInitialBounds);
    if (didFit) {
      this.hasAppliedInitialBounds = true;
      this.lastAppliedFitBoundsFingerprint = fingerprint || this.lastAppliedFitBoundsFingerprint;
    }
  }

  private buildTrackBoundsFingerprint(tracks: readonly TrackMapRenderData[]): string {
    return (tracks || []).map(track => {
      const positions = track.positions || [];
      const firstPosition = positions[0];
      const lastPosition = positions[positions.length - 1];
      return [
        track.id,
        positions.length,
        firstPosition?.latitudeDegrees ?? '',
        firstPosition?.longitudeDegrees ?? '',
        lastPosition?.latitudeDegrees ?? '',
        lastPosition?.longitudeDegrees ?? '',
      ].join(':');
    }).join('|');
  }

  private resolveInitialCamera(): { center: [number, number]; zoom: number } {
    return resolveTrackMapInitialCamera(this.buildTracks().flatMap(track => track.positions), { fallbackZoom: 2 });
  }

  private resolveRouteDate(route: FirestoreRouteJSON | null): Date | number | null {
    return this.toDateLike(route?.importedAt)
      || this.toDateLike(route?.createdAt)
      || this.toDateLike(route?.originalFiles?.[0]?.startDate)
      || this.toDateLike(route?.originalFile?.startDate);
  }

  private toDateLike(value: unknown): Date | number | null {
    if (value instanceof Date || typeof value === 'number') {
      return value;
    }
    if (typeof (value as { toDate?: unknown })?.toDate === 'function') {
      return (value as { toDate: () => Date }).toDate();
    }
    return null;
  }

  private resolveRouteSourceLabel(route: FirestoreRouteJSON | null): string {
    return `${route?.srcFileType || route?.sourceSummary?.sourceServiceName || 'Route'}`.trim().toUpperCase();
  }

  private resolvePrimaryRouteFileType(route: FirestoreRouteJSON): string | undefined {
    return `${route.srcFileType || route.originalFiles?.[0]?.extension || route.originalFile?.extension || ''}`.trim() || undefined;
  }

  private hasRenderableMapContainer(mapElement: HTMLElement): boolean {
    const rect = mapElement.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  private detachMapLifecycleHandlers(map: any | null): void {
    if (!map?.off || !this.mapLifecycleHandlers.length) {
      this.mapLifecycleHandlers = [];
      return;
    }

    this.mapLifecycleHandlers.forEach(({ eventName, handler }) => {
      map.off(eventName, handler);
    });
    this.mapLifecycleHandlers = [];
  }
}
