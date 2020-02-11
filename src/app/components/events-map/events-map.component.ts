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
import { MapThemes } from '@sports-alliance/sports-lib/lib/users/user.map.settings.interface';
import { DataPositionInterface } from '../../../../../sports-lib/src/data/data.position.interface';
import { DataStartPosition } from '@sports-alliance/sports-lib/lib/data/data.start-position';
import { MapAbstract } from '../map/map.abstract';
import MarkerClusterer from '@google/markerclustererplus'
import { EventColorService } from '../../services/color/app.event.color.service';
import { ActivityTypes } from '@sports-alliance/sports-lib/lib/activities/activity.types';

@Component({
  selector: 'app-events-map',
  templateUrl: './events-map.component.html',
  styleUrls: ['./events-map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventsMapComponent extends MapAbstract implements OnChanges, AfterViewInit {
  @ViewChild(AgmMap) agmMap;
  @Input() events: EventInterface[];
  @Input() theme: MapThemes;
  @Input() isLoading: boolean;

  public dataPositions: DataPositionInterface[] = [];
  public latLngArray: google.maps.LatLng[] = [];
  public markers: google.maps.Marker[] = [];


  private nativeMap: google.maps.Map;
  private heatMap: google.maps.visualization.HeatmapLayer;
  private markerClusterer: MarkerClusterer;

  constructor(
    private changeDetectorRef: ChangeDetectorRef, private eventColorService: EventColorService) {
    super(changeDetectorRef);
  }

  ngAfterViewInit() {
    this.agmMap.mapReady.subscribe(map => {
      this.nativeMap = map;
      // const trafficLayer = new google.maps.TrafficLayer();
      // trafficLayer.setMap(map);
      // Latlng and heatmap
      this.latLngArray = this.getLatLngArray(this.events);
      this.heatMap = new google.maps.visualization.HeatmapLayer({
        map: this.nativeMap,
        data: this.latLngArray,
        radius: 30,
        // dissipating: false,
      });
      // Markers + layer
      this.markers = this.getMarkersFromEvents(this.events);
      this.markerClusterer = new MarkerClusterer(map,
        this.markers,
        {
          imagePath: '/assets/icons/heatmap/m'
        });
      this.nativeMap.fitBounds(this.getBounds(this.getStartPositionsFromEvents(this.events)))
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.events) {
      return;
    }

    if (!changes.events) {
      return;
    }

    // Only process heatmaps once Google is initialized (map on load)
    if (this.heatMap) {
      this.latLngArray = this.getLatLngArray(this.events);
      this.heatMap.setData(this.latLngArray);
      // this.nativeMap.fitBounds(this.getBounds(this.getStartPositionsFromEvents(this.events)))

    }
    // Only process custers once Google is initialized (map on load)
    if (this.markerClusterer) {
      this.markerClusterer.clearMarkers();
      this.markers = this.getMarkersFromEvents(this.events);
      this.markerClusterer.addMarkers(this.markers);
      this.markerClusterer.repaint();
    }
    if (this.nativeMap) {
      this.nativeMap.fitBounds(this.getBounds(this.getStartPositionsFromEvents(this.events)))
    }
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
        markersArray.push(new google.maps.Marker({
          position: {lat: location.latitudeDegrees, lng: location.longitudeDegrees},
          // label: labels[i % labels.length]
          icon: {
            path: 'M256 8C119 8 8 119 8 256s111 248 248 248 248-111 248-248S393 8 256 8z',
            // url: "/assets/icons/circle.svg",
            anchor: new google.maps.Point(264, 244), // Magic dont ask me
            fillOpacity: 1,
            fillColor: this.eventColorService.getColorForActivityTypeByActivityTypeGroup(event.getActivityTypesAsArray().length > 1 ? ActivityTypes.Multisport : ActivityTypes[event.getActivityTypesAsArray()[0]]),
            strokeWeight: 1,
            strokeColor: 'black',
            scale: 0.04,
            // labelOrigin: labelOriginFilled
            // path: "M 12,2 C 8.1340068,2 5,5.1340068 5,9 c 0,5.25 7,13 7,13 0,0 7,-7.75 7,-13 0,-3.8659932 -3.134007,-7 -7,-7 z"
          }
        }))
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
