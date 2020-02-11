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


  public dataPositions: DataPositionInterface[] = [];
  public latLngArray: google.maps.LatLng[] = [];

  private map: google.maps.Map;
  private heatMap: google.maps.visualization.HeatmapLayer;

  constructor(
    private changeDetectorRef: ChangeDetectorRef) {
    super(changeDetectorRef);
  }

  ngAfterViewInit() {
    this.agmMap.mapReady.subscribe(map => {
      this.map = map;
      // const trafficLayer = new google.maps.TrafficLayer();
      // trafficLayer.setMap(map);
      this.heatMap = new google.maps.visualization.HeatmapLayer({
        data: this.latLngArray,
        radius: 20
      });
      this.heatMap.setMap(map);
      this.agmMap._mapsWrapper.fitBounds(this.getBounds(this.dataPositions))
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.events) {
      return;
    }
    this.dataPositions = this.events.reduce((positionsArray, event) => {
      const eventStartPositionStat = <DataStartPosition>event.getStat(DataStartPosition.type);
      if (eventStartPositionStat) {
        positionsArray.push(eventStartPositionStat.getValue())
      }
      return positionsArray;
    }, []);
    if (this.heatMap) {
      this.latLngArray = this.dataPositions.map(startPosition => {
          return new google.maps.LatLng(startPosition.latitudeDegrees, startPosition.longitudeDegrees)
        }
      );
      this.heatMap.setData(this.latLngArray);
      this.agmMap._mapsWrapper.fitBounds(this.getBounds(this.dataPositions))
    }
  }
}
