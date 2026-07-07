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
} from '@angular/core';
import type { FirestoreRouteJSON } from '@shared/app-route.interface';
import { buildRoutePreviewMapTracks } from '../../../helpers/route-preview-map.helper';
import { AppMapStyleName } from '../../../models/app-user.interface';
import { SharedModule } from '../../../modules/shared.module';
import { LoggerService } from '../../../services/logger.service';
import { MarkerFactoryService } from '../../../services/map/marker-factory.service';
import { MapboxAutoResizeService } from '../../../services/map/mapbox-auto-resize.service';
import { MapboxStyleSynchronizer } from '../../../services/map/mapbox-style-synchronizer';
import { isStyleReady } from '../../../services/map/mapbox-style-ready.utils';
import { resolveTrackMapInitialCamera } from '../../../services/map/track-map-view-state.helper';
import { TrackMapManager, TrackMapRenderData } from '../../../services/map/track-map.manager';
import { MapStyleName } from '../../../services/map/map-style.types';
import { MapStyleService } from '../../../services/map-style.service';
import { MapboxLoaderService } from '../../../services/mapbox-loader.service';
import { MapAbstractDirective } from '../../map/map-abstract.directive';

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

  @Input() set mapStyle(value: AppMapStyleName | MapStyleName | undefined) {
    this.mapStyleSignal.set(this.mapStyleService.normalizeStyle(value));
  }

  public get mapStyle(): MapStyleName {
    return this.mapStyleSignal();
  }

  public apiLoaded = signal(false);
  public mapLoadFailed = false;
  public noMapData = false;

  private readonly mapStyleSignal = signal<MapStyleName>('default');
  private readonly mapManager: TrackMapManager;
  private mapInstance = signal<any | null>(null);
  private mapStyleSynchronizer = signal<MapboxStyleSynchronizer | undefined>(undefined);
  private mapReady = false;
  private hasAppliedInitialBounds = false;
  private pendingFitBoundsTimeout: ReturnType<typeof setTimeout> | null = null;
  private mapLifecycleHandlers: Array<{ eventName: string; handler: () => void }> = [];
  private destroyed = false;

  constructor(
    private zone: NgZone,
    private changeDetectorRef: ChangeDetectorRef,
    private markerFactory: MarkerFactoryService,
    private mapboxLoader: MapboxLoaderService,
    private mapboxAutoResizeService: MapboxAutoResizeService,
    private mapStyleService: MapStyleService,
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
    if (changes.routes) {
      this.renderRoutePreviews(true);
    }
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
        onResize: () => this.zone.run(() => this.fitBoundsToRoutes()),
        throttleMs: 150,
      });
      map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

      const applyReadyState = () => {
        if (!isStyleReady(map)) {
          return;
        }
        const wasReady = this.mapReady;
        this.mapReady = true;
        if (!wasReady) {
          this.apiLoaded.set(true);
        }
        this.renderRoutePreviews(true);
        this.changeDetectorRef.markForCheck();
      };

      ['style.load', 'style.import.load', 'styledata', 'idle', 'load'].forEach((eventName) => {
        const handler = () => this.zone.run(() => applyReadyState());
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
      showEndpointMarkers: tracks.length <= 24,
      strokeWidth: 2.75,
    });
    this.changeDetectorRef.markForCheck();

    if (shouldFitBounds && tracks.length) {
      this.scheduleFitBounds();
    }
  }

  private buildTracks(): TrackMapRenderData[] {
    return buildRoutePreviewMapTracks(this.routes)
      .map(track => ({
        ...track,
        strokeColor: this.mapStyleService.adjustColorForTheme(track.strokeColor, this.appTheme()),
      }));
  }

  private scheduleFitBounds(): void {
    if (this.pendingFitBoundsTimeout) {
      clearTimeout(this.pendingFitBoundsTimeout);
    }
    this.pendingFitBoundsTimeout = setTimeout(() => {
      this.pendingFitBoundsTimeout = null;
      this.fitBoundsToRoutes();
    }, 150);
  }

  private fitBoundsToRoutes(): void {
    if (!this.mapReady) {
      return;
    }
    const didFit = this.mapManager.fitBoundsToTracks(this.hasAppliedInitialBounds);
    if (didFit) {
      this.hasAppliedInitialBounds = true;
    }
  }

  private resolveInitialCamera(): { center: [number, number]; zoom: number } {
    return resolveTrackMapInitialCamera(this.buildTracks().flatMap(track => track.positions), { fallbackZoom: 2 });
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
