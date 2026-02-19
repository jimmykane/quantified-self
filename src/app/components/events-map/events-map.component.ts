import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
  effect,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  ActivityTypes,
  DataDistance,
  DataPaceAvg,
  DataSpeedAvg,
  DataStartPosition,
  DataSwimPaceAvg,
  DataDuration,
  EventInterface,
  User,
} from '@sports-alliance/sports-lib';
import { MapAbstractDirective } from '../map/map-abstract.directive';
import { LoggerService } from '../../services/logger.service';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { MapboxLoaderService } from '../../services/mapbox-loader.service';
import { MapStyleService } from '../../services/map-style.service';
import { MapboxStyleSynchronizer } from '../../services/map/mapbox-style-synchronizer';
import { MapStyleName } from '../../services/map/map-style.types';
import {
  MapEventPopupContent,
  MapEventPopupContentService
} from '../../services/map/map-event-popup-content.service';
import {
  bindLayerClickOnce,
  LayerBindingRegistry,
  removeLayerIfExists,
  removeSourceIfExists,
  setPaintIfLayerExists,
  unbindLayerClicks,
  upsertGeoJsonSource
} from '../../services/map/mapbox-layer.utils';
import { attachStyleReloadHandler, isStyleReady, runWhenStyleReady } from '../../services/map/mapbox-style-ready.utils';

interface EventPointFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: {
    eventId: string;
    color: string;
  };
}

@Component({
  selector: 'app-events-map',
  templateUrl: './events-map.component.html',
  styleUrls: ['./events-map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DatePipe],
  standalone: false
})
export class EventsMapComponent extends MapAbstractDirective implements OnChanges, AfterViewInit, OnInit, OnDestroy {
  private static readonly EVENTS_SOURCE_ID = 'events-map-events-source';
  private static readonly EVENTS_UNCLUSTERED_LAYER_ID = 'events-map-events-unclustered';
  private static readonly EVENTS_CLUSTER_LAYER_ID = 'events-map-events-clusters';
  private static readonly EVENTS_CLUSTER_COUNT_LAYER_ID = 'events-map-events-cluster-count';

  @ViewChild('mapDiv', { static: false }) mapDiv?: ElementRef<HTMLDivElement>;
  @Input() events: EventInterface[] = [];
  @Input() user?: User;
  @Input() clusterMarkers = true;

  @Input() set mapStyle(value: MapStyleName | undefined) {
    this.mapStyleSignal.set(this.mapStyleService.normalizeStyle(value));
  }

  public get mapStyle(): MapStyleName {
    return this.mapStyleSignal();
  }

  public noMapData = false;
  public selectedEvent?: EventInterface;
  public selectedEventPopupContent: MapEventPopupContent | null = null;
  public apiLoaded = signal(false);

  private readonly mapStyleSignal = signal<MapStyleName>('default');
  private mapInstance = signal<any | null>(null);
  private mapStyleSynchronizer = signal<MapboxStyleSynchronizer | undefined>(undefined);
  private mapboxgl: any;

  private styleLoadHandlerCleanup: (() => void) | null = null;
  private styleReadyHandlerCleanup: (() => void) | null = null;
  private layerClickBindings: LayerBindingRegistry = [];
  private eventsById = new Map<string, EventInterface>();
  private currentSourceClusterMode: boolean | null = null;
  private pendingEventsFitBounds = true;
  private lastPopupDebugFingerprint: string | null = null;

  constructor(
    private zone: NgZone,
    private changeDetectorRef: ChangeDetectorRef,
    private eventColorService: AppEventColorService,
    private mapboxLoader: MapboxLoaderService,
    private mapStyleService: MapStyleService,
    private popupContentService: MapEventPopupContentService,
    private router: Router,
    protected logger: LoggerService
  ) {
    super(changeDetectorRef, logger);

    effect(() => {
      const map = this.mapInstance();
      const synchronizer = this.mapStyleSynchronizer();
      const theme = this.appTheme();
      const mapStyle = this.mapStyleSignal();

      if (!map || !synchronizer) {
        return;
      }

      synchronizer.update(this.mapStyleService.resolve(mapStyle, theme));
    });
  }

  ngOnInit(): void {
    this.mapStyleSignal.set(this.mapStyleService.normalizeStyle(this.mapStyleSignal()));
  }

  async ngAfterViewInit(): Promise<void> {
    await this.initializeMap();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.events) {
      this.pendingEventsFitBounds = true;
    }

    if (!this.mapInstance()) {
      return;
    }

    this.renderMapData();
  }

  ngOnDestroy(): void {
    const map = this.mapInstance();
    this.styleLoadHandlerCleanup?.();
    this.styleLoadHandlerCleanup = null;
    this.styleReadyHandlerCleanup?.();
    this.styleReadyHandlerCleanup = null;
    unbindLayerClicks(map, this.layerClickBindings);

    if (map?.remove) {
      map.remove();
    }

    this.mapInstance.set(null);
    this.mapStyleSynchronizer.set(undefined);
  }

  public clearSelectedEvent(): void {
    this.selectedEvent = undefined;
    this.selectedEventPopupContent = null;

    if (this.events?.length) {
      this.fitBoundsToEvents(false);
    }

    this.changeDetectorRef.markForCheck();
  }

  public openSelectedEvent(): void {
    const eventId = this.selectedEvent?.getID?.();
    const userId = this.user?.uid;
    if (!eventId || !userId) {
      return;
    }

    void this.router.navigate(['/user', userId, 'event', eventId]);
    this.clearSelectedEvent();
  }

  public getSelectedEventPopupContent(event: EventInterface | null | undefined): MapEventPopupContent {
    return this.popupContentService.buildFromEvent(event);
  }

  private async initializeMap(): Promise<void> {
    if (!this.mapDiv?.nativeElement || this.mapInstance()) {
      return;
    }

    try {
      const resolvedStyle = this.mapStyleService.resolve(this.mapStyleSignal(), this.appTheme());
      const initialCamera = this.resolveInitialCamera();
      const initialBounds = this.resolveInitialBounds();
      const mapOptions: any = {
        style: resolvedStyle.styleUrl,
      };

      if (initialBounds) {
        mapOptions.bounds = initialBounds;
        mapOptions.fitBoundsOptions = {
          padding: 80,
          duration: 0,
          animate: false,
        };
      } else {
        mapOptions.zoom = initialCamera.zoom;
        mapOptions.center = initialCamera.center;
      }

      if (this.mapStyleService.isStandard(resolvedStyle.styleUrl) && resolvedStyle.preset) {
        mapOptions.config = { basemap: { lightPreset: resolvedStyle.preset } };
      }

      const map = await this.mapboxLoader.createMap(this.mapDiv.nativeElement, mapOptions);
      this.mapboxgl = await this.mapboxLoader.loadMapbox();

      this.mapInstance.set(map);
      this.mapStyleSynchronizer.set(this.mapStyleService.createSynchronizer(map));

      this.styleLoadHandlerCleanup = attachStyleReloadHandler(
        map,
        () => {
          this.zone.run(() => {
            this.currentSourceClusterMode = null;
            this.renderMapData();
          });
        },
        'events-map-component'
      );

      this.styleReadyHandlerCleanup?.();
      this.styleReadyHandlerCleanup = runWhenStyleReady(
        map,
        () => {
          this.zone.run(() => {
            this.apiLoaded.set(true);
            this.renderMapData();
            this.changeDetectorRef.markForCheck();
          });
        }
      );

      map.on('load', () => {
        this.zone.run(() => {
          this.apiLoaded.set(true);
          this.renderMapData();
          this.changeDetectorRef.markForCheck();
        });
      });
    } catch (error) {
      this.logger.error('[EventsMapComponent] Failed to initialize Mapbox map.', error);
      this.noMapData = true;
      this.apiLoaded.set(true);
      this.changeDetectorRef.markForCheck();
    }
  }

  private renderMapData(): void {
    const map = this.mapInstance();
    if (!map || !isStyleReady(map)) {
      return;
    }

    this.renderEventLayers();
  }

  private renderEventLayers(): void {
    const map = this.mapInstance();
    if (!map) {
      return;
    }

    const pointFeatures = this.buildEventPointFeatures();
    if (!pointFeatures.length) {
      this.noMapData = true;
      this.clearEventLayersAndSource();
      this.changeDetectorRef.markForCheck();
      return;
    }

    this.noMapData = false;

    const sourceData: { type: 'FeatureCollection'; features: EventPointFeature[] } = {
      type: 'FeatureCollection',
      features: pointFeatures,
    };

    this.ensureEventsSource(sourceData);

    ensureEventPointLayers(
      map,
      this.clusterMarkers,
      EventsMapComponent.EVENTS_UNCLUSTERED_LAYER_ID,
      EventsMapComponent.EVENTS_CLUSTER_LAYER_ID,
      EventsMapComponent.EVENTS_CLUSTER_COUNT_LAYER_ID,
      EventsMapComponent.EVENTS_SOURCE_ID
    );

    this.bindEventLayerInteractions();

    if (this.pendingEventsFitBounds && !this.selectedEvent) {
      this.fitBoundsToPointFeatures(pointFeatures, false);
      this.pendingEventsFitBounds = false;
    }

    this.changeDetectorRef.markForCheck();
  }

  private ensureEventsSource(sourceData: { type: 'FeatureCollection'; features: EventPointFeature[] }): void {
    const map = this.mapInstance();
    if (!map) {
      return;
    }

    const shouldCluster = this.clusterMarkers === true;
    if (this.currentSourceClusterMode !== null && this.currentSourceClusterMode !== shouldCluster) {
      this.clearEventLayersAndSource();
      this.currentSourceClusterMode = null;
    }

    upsertGeoJsonSource(map, EventsMapComponent.EVENTS_SOURCE_ID, sourceData, shouldCluster
      ? {
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 14,
      }
      : {}
    );
    this.currentSourceClusterMode = shouldCluster;
  }

  private bindEventLayerInteractions(): void {
    const map = this.mapInstance();
    if (!map) {
      return;
    }

    unbindLayerClicks(map, this.layerClickBindings);

    bindLayerClickOnce(
      map,
      this.layerClickBindings,
      EventsMapComponent.EVENTS_UNCLUSTERED_LAYER_ID,
      (event) => {
        const eventId = String(event?.features?.[0]?.properties?.eventId || '');
        if (!eventId) {
          return;
        }
        this.zone.run(() => {
          this.onEventPointClick(eventId);
        });
      }
    );

    if (this.clusterMarkers) {
      bindLayerClickOnce(
        map,
        this.layerClickBindings,
        EventsMapComponent.EVENTS_CLUSTER_LAYER_ID,
        (event) => {
          const feature = event?.features?.[0];
          const clusterId = feature?.properties?.cluster_id;
          const coordinates = feature?.geometry?.coordinates;

          if (!Number.isFinite(clusterId) || !Array.isArray(coordinates)) {
            return;
          }

          const source = map.getSource?.(EventsMapComponent.EVENTS_SOURCE_ID);
          if (!source || typeof source.getClusterExpansionZoom !== 'function') {
            return;
          }

          source.getClusterExpansionZoom(clusterId, (error: any, zoom: number) => {
            if (error) {
              this.logger.warn('[EventsMapComponent] Failed to resolve cluster expansion zoom.', error);
              return;
            }
            map.easeTo?.({
              center: coordinates,
              zoom: Math.min(zoom, 17),
            });
          });
        }
      );
    }
  }

  private buildEventPointFeatures(): EventPointFeature[] {
    this.eventsById.clear();

    return (this.events || []).reduce<EventPointFeature[]>((features, event) => {
      const eventId = event?.getID?.();
      if (!eventId) {
        return features;
      }

      const coordinates = this.resolveEventStartCoordinates(event);
      if (!coordinates) {
        return features;
      }

      const activityTypes = event.getActivityTypesAsArray?.() || [];
      const activityType = activityTypes.length > 1
        ? ActivityTypes.Multisport
        : (activityTypes[0] as ActivityTypes);

      const color = this.resolveMarkerColor(activityType);

      this.eventsById.set(eventId, event);
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates,
        },
        properties: {
          eventId,
          color,
        },
      });

      return features;
    }, []);
  }

  private resolveMarkerColor(activityType: ActivityTypes): string {
    try {
      const color = this.eventColorService.getColorForActivityTypeByActivityTypeGroup(activityType);
      return color || '#2ca3ff';
    } catch {
      return '#2ca3ff';
    }
  }

  private onEventPointClick(eventId: string): void {
    const event = this.eventsById.get(eventId);
    if (!event) {
      return;
    }

    if (this.selectedEvent?.getID?.() === eventId) {
      this.logPopupStatSnapshot('click:selected:duplicate', event);
      return;
    }

    this.lastPopupDebugFingerprint = null;
    const popupContent = this.popupContentService.buildFromEvent(event);
    this.logPopupStatSnapshot('click:selected', event, popupContent);
    this.logPopupStatSnapshot('popup:build', event, popupContent);
    this.selectedEventPopupContent = popupContent;
    this.selectedEvent = event;
    this.changeDetectorRef.markForCheck();
  }

  private clearEventLayersAndSource(): void {
    const map = this.mapInstance();
    if (!map) {
      return;
    }

    unbindLayerClicks(map, this.layerClickBindings);

    removeLayerIfExists(map, EventsMapComponent.EVENTS_CLUSTER_COUNT_LAYER_ID);
    removeLayerIfExists(map, EventsMapComponent.EVENTS_CLUSTER_LAYER_ID);
    removeLayerIfExists(map, EventsMapComponent.EVENTS_UNCLUSTERED_LAYER_ID);
    removeSourceIfExists(map, EventsMapComponent.EVENTS_SOURCE_ID);
  }

  private fitBoundsToEvents(animate: boolean): void {
    const pointFeatures = this.buildEventPointFeatures();
    this.fitBoundsToPointFeatures(pointFeatures, animate);
  }

  private fitBoundsToPointFeatures(pointFeatures: EventPointFeature[], animate: boolean): void {
    if (!this.mapboxgl) {
      return;
    }

    const bounds = new this.mapboxgl.LngLatBounds();
    let hasPoints = false;

    pointFeatures.forEach((feature) => {
      bounds.extend(feature.geometry.coordinates);
      hasPoints = true;
    });

    if (!hasPoints) {
      return;
    }

    this.mapInstance()?.fitBounds?.(bounds, {
      padding: 80,
      animate,
    });
  }

  private resolveInitialCamera(): { center: [number, number]; zoom: number } {
    const firstCoordinates = (this.events || [])
      .map((event) => this.resolveEventStartCoordinates(event))
      .find((coordinates): coordinates is [number, number] => Array.isArray(coordinates));

    if (firstCoordinates) {
      return {
        center: firstCoordinates,
        zoom: 10,
      };
    }

    return {
      center: [0, 0],
      zoom: 2,
    };
  }

  private resolveInitialBounds(): [[number, number], [number, number]] | null {
    const coordinates = (this.events || [])
      .map((event) => this.resolveEventStartCoordinates(event))
      .filter((coordinate): coordinate is [number, number] => Array.isArray(coordinate));

    if (coordinates.length < 2) {
      return null;
    }

    let minLongitude = Number.POSITIVE_INFINITY;
    let minLatitude = Number.POSITIVE_INFINITY;
    let maxLongitude = Number.NEGATIVE_INFINITY;
    let maxLatitude = Number.NEGATIVE_INFINITY;

    coordinates.forEach(([longitudeDegrees, latitudeDegrees]) => {
      if (longitudeDegrees < minLongitude) minLongitude = longitudeDegrees;
      if (longitudeDegrees > maxLongitude) maxLongitude = longitudeDegrees;
      if (latitudeDegrees < minLatitude) minLatitude = latitudeDegrees;
      if (latitudeDegrees > maxLatitude) maxLatitude = latitudeDegrees;
    });

    return [
      [minLongitude, minLatitude],
      [maxLongitude, maxLatitude],
    ];
  }

  private resolveEventStartCoordinates(event: EventInterface): [number, number] | null {
    const startPositionStat = event.getStat(DataStartPosition.type) as DataStartPosition;
    const location = startPositionStat?.getValue?.();
    if (!Number.isFinite(location?.longitudeDegrees) || !Number.isFinite(location?.latitudeDegrees)) {
      return null;
    }
    return [location.longitudeDegrees, location.latitudeDegrees];
  }

  private logPopupStatSnapshot(
    stage: string,
    event: EventInterface | null | undefined,
    popupContent?: MapEventPopupContent
  ): void {
    if (!event) {
      this.logger.info('[EventsMapPopupDebug] snapshot', { stage, hasEvent: false });
      return;
    }

    const speedStat = event.getStat?.(DataSpeedAvg.type);
    const paceStat = event.getStat?.(DataPaceAvg.type);
    const swimPaceStat = event.getStat?.(DataSwimPaceAvg.type);
    const durationStat = event.getDuration?.() || event.getStat?.(DataDuration.type);
    const distanceStat = event.getDistance?.() || event.getStat?.(DataDistance.type);
    const activityTypes = event.getActivityTypesAsArray?.() || [];
    const fingerprintPayload = {
      stage,
      eventId: event.getID?.(),
      activityTypes,
      duration: this.toStatDebugValue(durationStat),
      distance: this.toStatDebugValue(distanceStat),
      speed: this.toStatDebugValue(speedStat),
      pace: this.toStatDebugValue(paceStat),
      swimPace: this.toStatDebugValue(swimPaceStat),
      popupEffort: popupContent?.metrics?.[2]?.value || null,
      popupEffortUnit: popupContent?.metrics?.[2]?.label || null,
      popupMetrics: popupContent?.metrics || null,
    };
    const fingerprint = JSON.stringify(fingerprintPayload);
    if (stage === 'popup:build' && this.lastPopupDebugFingerprint === fingerprint) {
      return;
    }

    this.lastPopupDebugFingerprint = fingerprint;
    this.logger.info('[EventsMapPopupDebug] snapshot', fingerprintPayload);
  }

  private toStatDebugValue(stat: any): string {
    if (!stat) {
      return '--';
    }

    const displayValue = stat.getDisplayValue?.();
    const displayUnit = stat.getDisplayUnit?.();
    const value = displayValue !== undefined && displayValue !== null ? String(displayValue) : '';
    const unit = displayUnit !== undefined && displayUnit !== null ? String(displayUnit) : '';
    return `${value}${unit ? ` ${unit}` : ''}`.trim() || '--';
  }
}

function ensureEventPointLayers(
  map: any,
  clustered: boolean,
  unclusteredLayerId: string,
  clusterLayerId: string,
  clusterCountLayerId: string,
  sourceId: string
): void {
  if (!map) {
    return;
  }

  if (!map.getLayer?.(unclusteredLayerId)) {
    map.addLayer?.({
      id: unclusteredLayerId,
      type: 'circle',
      source: sourceId,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['coalesce', ['get', 'color'], '#2ca3ff'],
        'circle-radius': 6,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.2,
        'circle-opacity': 0.95,
      },
    });
  }

  setPaintIfLayerExists(map, unclusteredLayerId, {
    'circle-color': ['coalesce', ['get', 'color'], '#2ca3ff'],
    'circle-radius': 6,
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': 1.2,
    'circle-opacity': 0.95,
  });

  if (!clustered) {
    removeLayerIfExists(map, clusterCountLayerId);
    removeLayerIfExists(map, clusterLayerId);
    return;
  }

  if (!map.getLayer?.(clusterLayerId)) {
    map.addLayer?.({
      id: clusterLayerId,
      type: 'circle',
      source: sourceId,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step',
          ['get', 'point_count'],
          '#50b5ff',
          20,
          '#3288d8',
          50,
          '#2266a5',
          100,
          '#1a4f7d',
        ],
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          16,
          20,
          20,
          50,
          24,
          100,
          28,
        ],
        'circle-opacity': 0.9,
      },
    });
  }

  if (!map.getLayer?.(clusterCountLayerId)) {
    map.addLayer?.({
      id: clusterCountLayerId,
      type: 'symbol',
      source: sourceId,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 12,
      },
      paint: {
        'text-color': '#ffffff',
      },
    });
  }
}
