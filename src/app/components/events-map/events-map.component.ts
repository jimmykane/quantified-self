import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { EventInterface } from '@sports-alliance/sports-lib/lib/events/event.interface';
import { AgmMap } from '@agm/core';
import { MapThemes, MapTypes } from '@sports-alliance/sports-lib/lib/users/settings/user.map.settings.interface';
import { DataPositionInterface } from '../../../../../sports-lib/src/data/data.position.interface';
import { DataStartPosition } from '@sports-alliance/sports-lib/lib/data/data.start-position';
import { MapAbstract } from '../map/map.abstract';
import MarkerClusterer from '@google/markerclustererplus'
import { EventColorService } from '../../services/color/app.event.color.service';
import { ActivityTypes } from '@sports-alliance/sports-lib/lib/activities/activity.types';
import { DatePipe } from '@angular/common';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { EventService } from "../../services/app.event.service";
import { take } from "rxjs/operators";
import { ActivityInterface } from "@sports-alliance/sports-lib/lib/activities/activity.interface";
import { DataLatitudeDegrees } from "@sports-alliance/sports-lib/lib/data/data.latitude-degrees";
import { DataLongitudeDegrees } from "@sports-alliance/sports-lib/lib/data/data.longitude-degrees";

@Component({
  selector: 'app-events-map',
  templateUrl: './events-map.component.html',
  styleUrls: ['./events-map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DatePipe],
})

export class EventsMapComponent extends MapAbstract implements OnChanges, AfterViewInit {
  @ViewChild(AgmMap) agmMap;
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
  public selectedEventPositionsByActivity: { activity: ActivityInterface, color: string, positions: DataPositionInterface[] }[]

  private nativeMap: google.maps.Map;
  private heatMap: google.maps.visualization.HeatmapLayer;
  private markerClusterer: MarkerClusterer;


  constructor(
    private changeDetectorRef: ChangeDetectorRef, private eventColorService: EventColorService, private eventService: EventService) {
    super(changeDetectorRef);
  }

  ngAfterViewInit() {
    this.agmMap.mapReady.subscribe(map => {
      this.nativeMap = map;
      if (this.showHeatMap) {
        // const trafficLayer = new google.maps.TrafficLayer();
        // trafficLayer.setMap(map);
        // Latlng and heatmap
        this.latLngArray = this.getLatLngArray(this.events);
        this.heatMap = new google.maps.visualization.HeatmapLayer({
          map: this.nativeMap,
          data: this.latLngArray,
          radius: 50,
          // dissipating: false,
        });
      }
      // Markers + layer
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
      this.nativeMap.fitBounds(this.getBounds(this.getStartPositionsFromEvents(this.events)))
      this.changeDetectorRef.detectChanges();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.nativeMap) {
      return;
    }
    // Only process heatmaps once Google is initialized (map on load)
    if (this.heatMap) {
      this.latLngArray = this.getLatLngArray(this.events);
      this.heatMap.setData(this.latLngArray);
    }
    // Only process custers once Google is initialized (map on load)
    if (this.markerClusterer) {
      this.markerClusterer.clearMarkers();
      this.markers = this.getMarkersFromEvents(this.events);
      this.markerClusterer.addMarkers(this.markers);
      this.markerClusterer.repaint();
    }
    this.nativeMap.fitBounds(this.getBounds(this.getStartPositionsFromEvents(this.events)))
  }

  getStartPositionsFromEvents(events: EventInterface[]): DataPositionInterface[] {
    return events.reduce((positionsArray, event) => {
      const eventStartPositionStat = <DataStartPosition>event.getStat(DataStartPosition.type);
      if (eventStartPositionStat) {
        positionsArray.push(eventStartPositionStat.getValue())
      }
      return positionsArray;
    }, []);
  }

  private getMarkersFromEvents(events: EventInterface[]): google.maps.Marker[] {
    return events.reduce((markersArray: google.maps.Marker[], event: EventInterface) => {
      const eventStartPositionStat = <DataStartPosition>event.getStat(DataStartPosition.type);
      if (eventStartPositionStat) {
        const location = eventStartPositionStat.getValue();
        const marker = new google.maps.Marker({
          position: {lat: location.latitudeDegrees, lng: location.longitudeDegrees},
          title: `${event.getActivityTypesAsString()} for ${event.getDuration().getDisplayValue(false, false)} and ${event.getDistance().getDisplayValue()}${event.getDistance().getDisplayUnit()}`,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillOpacity: 1,
            fillColor: this.eventColorService.getColorForActivityTypeByActivityTypeGroup(event.getActivityTypesAsArray().length > 1 ? ActivityTypes.Multisport : ActivityTypes[event.getActivityTypesAsArray()[0]]),
            strokeWeight: 1,
            strokeColor: 'black',
            scale: 10,
          }
        });
        markersArray.push(marker);
        marker.addListener('click', async () => {
          this.loading();
          this.selectedEventPositionsByActivity = [];
          const activities = await this.eventService.getActivities(this.user, event.getID()).pipe(take(1)).toPromise()
          for (const activity of activities) {
            const streams = await this.eventService.getStreamsByTypes(
              this.user.uid, event.getID(), activity.getID(), [DataLatitudeDegrees.type, DataLongitudeDegrees.type]
            ).pipe(take(1)).toPromise();
            activity.addStreams(streams);
            this.selectedEventPositionsByActivity.push(
              {
                activity: activity,
                color: this.eventColorService.getColorForActivityTypeByActivityTypeGroup(ActivityTypes[activity.type]),
                positions: activity.getSquashedPositionData()
              }
            )
          }
          this.nativeMap.fitBounds(this.getBounds(this.selectedEventPositionsByActivity.reduce((accu, positionByActivity) => {
            return accu.concat(positionByActivity.positions)
          }, [])))
          this.selectedEvent = event
          this.loaded()
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
        latLngArray.push(new google.maps.LatLng(location.latitudeDegrees, location.longitudeDegrees))
      }
      return latLngArray;
    }, []);
  }
}
