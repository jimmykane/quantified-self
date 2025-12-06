import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  NgZone,
  OnChanges,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { GoogleMap, MapMarker } from '@angular/google-maps';
import { EventInterface } from '@sports-alliance/sports-lib/lib/events/event.interface';
import { MapThemes, MapTypes } from '@sports-alliance/sports-lib/lib/users/settings/user.map.settings.interface';
import { DataPositionInterface } from '@sports-alliance/sports-lib/lib/data/data.position.interface';
import { DataStartPosition } from '@sports-alliance/sports-lib/lib/data/data.start-position';
import { MapAbstractDirective } from '../map/map-abstract.directive';
import MarkerClusterer from '@googlemaps/markerclustererplus';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { ActivityTypes } from '@sports-alliance/sports-lib/lib/activities/activity.types';
import { DatePipe } from '@angular/common';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { AppEventService } from '../../services/app.event.service';
import { take } from 'rxjs/operators';
import { ActivityInterface } from '@sports-alliance/sports-lib/lib/activities/activity.interface';
import { DataLatitudeDegrees } from '@sports-alliance/sports-lib/lib/data/data.latitude-degrees';
import { DataLongitudeDegrees } from '@sports-alliance/sports-lib/lib/data/data.longitude-degrees';

@Component({
  selector: 'app-events-map',
  templateUrl: './events-map.component.html',
  styleUrls: ['./events-map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DatePipe],
  standalone: false
})
export class EventsMapComponent extends MapAbstractDirective implements OnChanges, AfterViewInit {
  @ViewChild(GoogleMap) googleMap: GoogleMap;
  @Input() events: EventInterface[];
  @Input() theme: MapThemes;
  @Input() type: MapTypes;
  @Input() user: User;
  @Input() isLoading: boolean;
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

      if (this.showHeatMap && this.events?.length) {
        this.latLngArray = this.getLatLngArray(this.events);
        this.heatMap = new google.maps.visualization.HeatmapLayer({
          map: this.nativeMap,
          data: this.latLngArray,
          radius: 50,
        });
      }

      // Create and add markers
      if (this.events?.length) {
        this.markers = this.getMarkersFromEvents(this.events);
        this.markers.forEach(marker => marker.setMap(this.nativeMap));

        if (this.clusterMarkers) {
          this.markerClusterer = new MarkerClusterer(map,
            this.markers,
            {
              imagePath: '/assets/icons/heatmap/m',
              enableRetinaIcons: true,
              averageCenter: true,
              maxZoom: 18,
              minimumClusterSize: 15,
            });
        }

        // Fit bounds to show all events
        const startPositions = this.getStartPositionsFromEvents(this.events);
        if (startPositions.length > 0) {
          this.nativeMap.fitBounds(this.getBounds(startPositions));
        }
      }
    });
    this.changeDetectorRef.detectChanges();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.nativeMap) return;

    this.zone.runOutsideAngular(() => {
      // Update heatmap data
      if (this.heatMap && this.events) {
        this.latLngArray = this.getLatLngArray(this.events);
        this.heatMap.setData(this.latLngArray);
      }

      // Update markers in clusterer
      if (this.markerClusterer && this.events) {
        this.markerClusterer.clearMarkers();
        this.markers = this.getMarkersFromEvents(this.events);
        this.markerClusterer.addMarkers(this.markers);
        this.markerClusterer.repaint();
      }

      // Fit bounds
      if (this.events?.length) {
        this.nativeMap.fitBounds(this.getBounds(this.getStartPositionsFromEvents(this.events)));
      }
    });
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
          title: `${event.getActivityTypesAsString()} for ${event.getDuration().getDisplayValue(false, false)} and ${event.getDistance().getDisplayValue()}${event.getDistance().getDisplayUnit()}`,
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
          for (const activity of activities) {
            const streams = await this.eventService.getStreamsByTypes(
              this.user.uid, event.getID(), activity.getID(), [DataLatitudeDegrees.type, DataLongitudeDegrees.type]
            ).pipe(take(1)).toPromise();
            activity.addStreams(streams);
            this.selectedEventPositionsByActivity.push({
              activity: activity,
              color: this.eventColorService.getColorForActivityTypeByActivityTypeGroup(ActivityTypes[activity.type]),
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
