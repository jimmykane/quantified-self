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
  OnInit
} from '@angular/core';
import { GoogleMap, MapMarker } from '@angular/google-maps';
import { EventInterface } from '@sports-alliance/sports-lib';
import { MapThemes, MapTypes } from '@sports-alliance/sports-lib';
import { DataPositionInterface } from '@sports-alliance/sports-lib';
import { DataStartPosition } from '@sports-alliance/sports-lib';
import { MapAbstractDirective } from '../map/map-abstract.directive';
import MarkerClusterer from '@googlemaps/markerclustererplus';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { DatePipe } from '@angular/common';
import { User } from '@sports-alliance/sports-lib';
import { AppEventService } from '../../services/app.event.service';
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
  @Input() theme: MapThemes;
  @Input() type: MapTypes;
  @Input() user: User;
  @Input() showHeatMap: boolean;
  @Input() clusterMarkers: boolean;

  public latLngArray: google.maps.LatLng[] = [];
  public markers: google.maps.Marker[] = [];
  public selectedEvent: EventInterface;
  public selectedEventPositionsByActivity: { activity: ActivityInterface, color: string, positions: DataPositionInterface[] }[];

  public mapOptions: google.maps.MapOptions = {
    controlSize: 32,
    disableDefaultUI: true,
    backgroundColor: 'transparent'
  };
  public mapCenter: google.maps.LatLngLiteral = { lat: 0, lng: 0 };
  public mapZoom = 3;
  public mapTypeId: string = 'roadmap';
  public apiLoaded = false;

  private nativeMap: google.maps.Map;
  private heatMap: google.maps.visualization.HeatmapLayer;
  private markerClusterer: MarkerClusterer;

  constructor(
    private zone: NgZone,
    private changeDetectorRef: ChangeDetectorRef,
    private eventColorService: AppEventColorService,
    private eventService: AppEventService) {
    super(changeDetectorRef);
  }

  ngOnInit(): void {
    this.loadGoogleMaps();
  }

  ngAfterViewInit() {
    // Initialize will happen via mapInitialized event
  }

  onMapReady(map: google.maps.Map) {
    this.zone.runOutsideAngular(() => {
      this.nativeMap = map;

      // Apply theme styles
      if (this.theme) {
        map.setOptions({ styles: this.getStyles(this.theme) });
      }

      // Set map type
      if (this.type) {
        this.mapTypeId = this.type as string;
      }

      if (this.apiLoaded) {
        this.initMapData();
      }
    });
    this.changeDetectorRef.detectChanges();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.nativeMap || !this.apiLoaded) return;

    this.zone.runOutsideAngular(() => {
      this.initMapData();
    });
  }

  private initMapData() {
    if (!this.nativeMap) return;

    // Update heatmap data
    if (this.showHeatMap && this.events?.length) {
      this.latLngArray = this.getLatLngArray(this.events);
      if (!this.heatMap) {
        this.heatMap = new google.maps.visualization.HeatmapLayer({
          map: this.nativeMap,
          data: this.latLngArray,
          radius: 50,
        });
      } else {
        this.heatMap.setData(this.latLngArray);
      }
    }

    // Create and add markers
    if (this.events?.length) {
      // Clear existing markers
      if (this.markers) {
        this.markers.forEach(m => m.setMap(null));
      }
      if (this.markerClusterer) {
        this.markerClusterer.clearMarkers();
      }

      this.markers = this.getMarkersFromEvents(this.events);
      this.markers.forEach(marker => marker.setMap(this.nativeMap));

      if (this.clusterMarkers) {
        if (!this.markerClusterer) {
          this.markerClusterer = new MarkerClusterer(this.nativeMap,
            this.markers,
            {
              imagePath: '/assets/icons/heatmap/m',
              enableRetinaIcons: true,
              averageCenter: true,
              maxZoom: 18,
              minimumClusterSize: 15,
            });
        } else {
          this.markerClusterer.addMarkers(this.markers);
          this.markerClusterer.repaint();
        }
      }

      // Fit bounds to show all events
      const startPositions = this.getStartPositionsFromEvents(this.events);
      if (startPositions.length > 0) {
        this.nativeMap.fitBounds(this.getBounds(startPositions));
      }
    }
  }

  private loadGoogleMaps() {
    if (typeof google === 'object' && typeof google.maps === 'object') {
      this.apiLoaded = true;
      this.changeDetectorRef.markForCheck();
      return;
    }

    const scriptSrc = `https://maps.googleapis.com/maps/api/js?key=${environment.firebase.apiKey}&libraries=visualization`;
    if (document.querySelector(`script[src="${scriptSrc}"]`)) {
      // Script is already loading or loaded, but 'google' object might not be ready yet.
      // We can poll or wait. Simpler approach for now is to trust that if script is there, it will load.
      // But since we need to flip apiLoaded to true, we should probably attach a listener if possible,
      // or just rely on a simple interval check if we can't easily hook into the existing script tag's onload.
      // However, a better way is to attach a new load listener to the existing script element.
      const existingScript = document.querySelector(`script[src="${scriptSrc}"]`) as HTMLScriptElement;

      if (!existingScript.getAttribute('data-loaded')) {
        const originalOnLoad = existingScript.onload;
        existingScript.onload = (e) => {
          if (originalOnLoad) {
            (originalOnLoad as any)(e);
          }
          this.zone.run(() => {
            this.apiLoaded = true;
            this.changeDetectorRef.markForCheck();
            if (this.nativeMap) {
              this.initMapData();
            }
          });
        };
      } else {
        this.apiLoaded = true;
        this.changeDetectorRef.markForCheck();
      }
      return;
    }

    const script = document.createElement('script');
    script.src = scriptSrc;
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
    script.onload = () => {
      script.setAttribute('data-loaded', 'true');
      this.zone.run(() => {
        this.apiLoaded = true;
        this.changeDetectorRef.markForCheck();
        // If map was already ready (e.g. somehow), init data. 
        // Realistically onMapReady triggers initMapData, but if API loads LATE, we need to trigger it if map is ready.
        if (this.nativeMap) {
          this.initMapData();
        }
      });
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

  private getMarkersFromEvents(events: EventInterface[]): google.maps.Marker[] {
    return events.reduce((markersArray: google.maps.Marker[], event: EventInterface) => {
      const eventStartPositionStat = <DataStartPosition>event.getStat(DataStartPosition.type);
      if (eventStartPositionStat) {
        const location = eventStartPositionStat.getValue();
        const marker = new google.maps.Marker({
          position: { lat: location.latitudeDegrees, lng: location.longitudeDegrees },
          title: `${event.getActivityTypesAsString()} for ${event.getDuration().getDisplayValue(false, false)} and ${event.getDistance().getDisplayValue()}${event.getDistance().getDisplayValue()}`,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillOpacity: 1,
            fillColor: this.eventColorService.getColorForActivityTypeByActivityTypeGroup(
              event.getActivityTypesAsArray().length > 1 ? ActivityTypes.Multisport : ActivityTypes[event.getActivityTypesAsArray()[0]]
            ),
            strokeWeight: 1,
            strokeColor: 'black',
            scale: 10,
          }
        });
        markersArray.push(marker);

        marker.addListener('click', async () => {
          this.loading();
          this.selectedEventPositionsByActivity = [];
          const activities = await this.eventService.getActivities(this.user, event.getID()).pipe(take(1)).toPromise();
          if (!activities) return;
          for (const activity of activities) {
            const streams = await this.eventService.getStreamsByTypes(
              this.user.uid, event.getID(), activity.getID(), [DataLatitudeDegrees.type, DataLongitudeDegrees.type]
            ).pipe(take(1)).toPromise();
            activity.addStreams(streams || []);
            this.selectedEventPositionsByActivity.push({
              activity: activity,
              color: this.eventColorService.getActivityColor(activities, activity),
              positions: activity.getSquashedPositionData()
            });
          }
          this.nativeMap.fitBounds(this.getBounds(this.selectedEventPositionsByActivity.reduce((accu, positionByActivity) => {
            return accu.concat(positionByActivity.positions);
          }, [])));
          this.selectedEvent = event;
          this.loaded();
        });
      }
      return markersArray;
    }, []);
  }

  private getLatLngArray(events: EventInterface[]): google.maps.LatLng[] {
    return events.reduce((latLngArray: google.maps.LatLng[], event: EventInterface) => {
      const eventStartPositionStat = <DataStartPosition>event.getStat(DataStartPosition.type);
      if (eventStartPositionStat) {
        const location = eventStartPositionStat.getValue();
        latLngArray.push(new google.maps.LatLng(location.latitudeDegrees, location.longitudeDegrees));
      }
      return latLngArray;
    }, []);
  }
}
