import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  NgZone,
  OnChanges,
  SimpleChanges,
  ViewChild,
  OnInit,
  signal,
} from '@angular/core';
import { GoogleMap } from '@angular/google-maps';
import { EventInterface } from '@sports-alliance/sports-lib';
import { MapTypes } from '@sports-alliance/sports-lib';
import { DataPositionInterface } from '@sports-alliance/sports-lib';
import { DataStartPosition } from '@sports-alliance/sports-lib';
import { MapAbstractDirective } from '../map/map-abstract.directive';
import { LoggerService } from '../../services/logger.service';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { DatePipe } from '@angular/common';
import { User } from '@sports-alliance/sports-lib';
import { AppEventService } from '../../services/app.event.service';
import { AppUserService } from '../../services/app.user.service';
import { GoogleMapsLoaderService } from '../../services/google-maps-loader.service';
import { MarkerFactoryService } from '../../services/map/marker-factory.service';

import { take } from 'rxjs/operators';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { DataLatitudeDegrees } from '@sports-alliance/sports-lib';
import { DataLongitudeDegrees } from '@sports-alliance/sports-lib';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-events-map',
  templateUrl: './events-map.component.html',
  styleUrls: ['./events-map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DatePipe],
  standalone: false
})
export class EventsMapComponent extends MapAbstractDirective implements OnChanges, AfterViewInit, OnInit {
  @ViewChild(GoogleMap) googleMap: GoogleMap;
  @Input() events: EventInterface[];
  @Input() type: MapTypes;
  @Input() user: User;
  @Input() clusterMarkers: boolean;

  public latLngArray: google.maps.LatLng[] = [];
  public markers: google.maps.marker.AdvancedMarkerElement[] = [];
  public selectedEvent: EventInterface;
  public selectedEventPositionsByActivity: { activity: ActivityInterface, color: string, positions: DataPositionInterface[] }[];

  public mapCenter = signal<google.maps.LatLngLiteral>({ lat: 0, lng: 0 });
  public mapZoom = signal(3);
  public mapTypeId = signal<google.maps.MapTypeId>('roadmap' as any);
  public apiLoaded = signal(false);

  public get mapOptions(): google.maps.MapOptions {
    return {
      controlSize: 32,
      disableDefaultUI: true,
      backgroundColor: 'transparent',
      mapTypeControl: true,
      mapTypeControlOptions: {
        mapTypeIds: ['roadmap', 'hybrid', 'terrain']
      },
      mapId: environment.googleMapsMapId,
      colorScheme: this.mapColorScheme()
    };
  }

  private nativeMap: google.maps.Map;
  private markerClusterer: MarkerClusterer;

  constructor(
    private zone: NgZone,
    private changeDetectorRef: ChangeDetectorRef,
    private eventColorService: AppEventColorService,
    private eventService: AppEventService,
    private userService: AppUserService,
    private mapsLoader: GoogleMapsLoaderService,
    private markerFactory: MarkerFactoryService,
    protected logger: LoggerService) {
    super(changeDetectorRef, logger);
  }

  // Class property to hold the loaded class
  // Class property to hold the loaded class
  private AdvancedMarkerElement: typeof google.maps.marker.AdvancedMarkerElement | null = null;

  async changeMapType(mapType: google.maps.MapTypeId) {
    if (!this.user) return;
    this.mapTypeId.set(mapType);
    this.user.settings.mapSettings.mapType = mapType as any;
    await this.userService.updateUserProperties(this.user, { settings: this.user.settings });
  }

  async ngOnInit(): Promise<void> {
    const mapsLib = await this.mapsLoader.importLibrary('maps');
    const markerLib = await this.mapsLoader.importLibrary('marker');

    this.AdvancedMarkerElement = markerLib.AdvancedMarkerElement;

    if (this.user?.settings?.mapSettings?.mapType) {
      this.mapTypeId.set(this.user.settings.mapSettings.mapType as any);
    }

    this.apiLoaded.set(true);
    this.changeDetectorRef.markForCheck();
    if (this.nativeMap) {
      this.initMapData();
    }
  }

  ngAfterViewInit() {
    // Initialize will happen via mapInitialized event
  }

  onMapReady(map: google.maps.Map) {
    this.zone.runOutsideAngular(() => {
      this.nativeMap = map;

      // Set map type
      if (this.type) {
        this.mapTypeId.set(this.type as any as google.maps.MapTypeId);
      }

      if (this.apiLoaded()) {
        this.initMapData();
      }
    });
    this.changeDetectorRef.detectChanges();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.nativeMap || !this.apiLoaded()) return;

    this.zone.runOutsideAngular(() => {
      this.initMapData();
    });
  }

  private initMapData() {
    if (!this.nativeMap) return;

    // Create and add markers
    if (this.events?.length) {
      // Clear existing markers
      if (this.markers) {
        this.markers.forEach(m => m.map = null);
      }
      if (this.markerClusterer) {
        this.markerClusterer.clearMarkers();
      }

      this.markers = this.getMarkersFromEvents(this.events);
      // for AdvancedMarkerElement, setting map via constructor is enough, or set properties.
      // But standard way is map. But we might use clusterer.
      // If using clusterer, we add to clusterer. If not, we add to map.
      if (!this.clusterMarkers) {
        this.markers.forEach(marker => marker.map = this.nativeMap);
      }

      if (this.clusterMarkers) {
        if (!this.markerClusterer) {
          this.markerClusterer = new MarkerClusterer({
            map: this.nativeMap,
            markers: this.markers,
            renderer: {
              render: ({ count, position }) => {
                return new google.maps.marker.AdvancedMarkerElement({
                  position,
                  content: this.markerFactory.createClusterMarker(count),
                  zIndex: Number(google.maps.Marker.MAX_ZINDEX) + count,
                });
              }
            }
          });
        } else {
          this.markerClusterer.addMarkers(this.markers);

        }
      }

      // Fit bounds to show all events
      const startPositions = this.getStartPositionsFromEvents(this.events);
      if (startPositions.length > 0) {
        this.nativeMap.fitBounds(this.getBounds(startPositions));
      }
    }
  }


  getStartPositionsFromEvents(events: EventInterface[]): DataPositionInterface[] {
    return events.reduce((positionsArray, event) => {
      const eventStartPositionStat = <DataStartPosition>event.getStat(DataStartPosition.type);
      if (eventStartPositionStat) {
        positionsArray.push(eventStartPositionStat.getValue());
      }
      return positionsArray;
    }, []);
  }

  getPolylinePath(positions: DataPositionInterface[]): google.maps.LatLngLiteral[] {
    return positions.map(pos => ({
      lat: pos.latitudeDegrees,
      lng: pos.longitudeDegrees
    }));
  }

  getPolylineOptions(color: string): google.maps.PolylineOptions {
    return {
      strokeColor: color,
      strokeWeight: 3,
      strokeOpacity: 1
    };
  }

  private getMarkersFromEvents(events: EventInterface[]): google.maps.marker.AdvancedMarkerElement[] {
    return events.reduce((markersArray: google.maps.marker.AdvancedMarkerElement[], event: EventInterface) => {
      const eventStartPositionStat = <DataStartPosition>event.getStat(DataStartPosition.type);
      if (eventStartPositionStat) {
        const location = eventStartPositionStat.getValue();

        const color = this.eventColorService.getColorForActivityTypeByActivityTypeGroup(
          event.getActivityTypesAsArray().length > 1 ? ActivityTypes.Multisport : ActivityTypes[event.getActivityTypesAsArray()[0]]
        );

        const marker = new this.AdvancedMarkerElement!({
          position: { lat: location.latitudeDegrees, lng: location.longitudeDegrees },
          title: `${event.getActivityTypesAsString()} for ${event.getDuration().getDisplayValue(false, false)} and ${event.getDistance().getDisplayValue()}`,
          content: this.markerFactory.createEventMarker(color)
        });
        markersArray.push(marker);

        marker.addListener('click', async () => {
          this.loading();
          this.selectedEventPositionsByActivity = [];

          // Use attachStreamsToEventWithActivities to get event with activities + streams
          // This handles original file parsing on the fly if needed
          const types = [DataLatitudeDegrees.type, DataLongitudeDegrees.type];

          // We only need one emission
          const populatedEvent = await this.eventService.attachStreamsToEventWithActivities(
            this.user,
            event,
            types
          ).pipe(take(1)).toPromise();

          if (!populatedEvent) {
            this.loaded();
            return;
          }

          const activities = populatedEvent.getActivities();
          if (!activities || activities.length === 0) {
            this.loaded();
            return;
          }

          for (const activity of activities) {
            this.selectedEventPositionsByActivity.push({
              activity: activity,
              color: this.eventColorService.getActivityColor(activities, activity),
              positions: activity.getSquashedPositionData()
            });
          }

          const allPositions = this.selectedEventPositionsByActivity.reduce((accu, positionByActivity) => {
            return accu.concat(positionByActivity.positions);
          }, []);

          if (allPositions.length > 0) {
            this.nativeMap.fitBounds(this.getBounds(allPositions));
          }

          this.selectedEvent = populatedEvent;
          this.loaded();
        });
      }
      return markersArray;
    }, []);
  }
}
