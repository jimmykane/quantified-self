import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, Input, OnChanges, OnInit,
  ViewChild
} from '@angular/core';
import {AgmMap, GoogleMapsAPIWrapper, LatLngBoundsLiteral, LatLngLiteral} from '@agm/core';
import {PointInterface} from '../../../../entities/points/point.interface';
import {EventInterface} from '../../../../entities/events/event.interface';
import {Log} from 'ng2-logger';

@Component({
  selector: 'app-event-card-map',
  templateUrl: './event.card.map.component.html',
  styleUrls: ['./event.card.map.component.css'],
  providers: [GoogleMapsAPIWrapper],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardMapComponent implements OnInit, OnChanges {
  @Input() event: EventInterface;
  @Input() resize: boolean;
  @ViewChild(AgmMap) agmMap;

  public gridListColumnCount = 2;
  public mapRowSpan = 2;

  private logger = Log.create(this.constructor.name);

  constructor(private changeDetectorRef: ChangeDetectorRef) {
  }

  ngOnInit() {
      this.gridListColumnCount = (window.innerWidth) > 640 ? 2 : 1;
      this.mapRowSpan = (window.innerWidth) > 640 ? 2 : 1;
  }

  ngOnChanges() {
    // @todo maybe this can be done in a different way
    if (this.resize) {
      this.agmMap.triggerResize().then(() => {
        this.agmMap._mapsWrapper.fitBounds(this.getBounds())
      });
    }
  }

  @HostListener('window:resize', ['$event.target.innerWidth'])
  onResize(width) {
    this.gridListColumnCount = width > 640 ? 2 : 1;
    this.mapRowSpan = width > 640 ? 2 : 1;
  }

  getActivityColor(index: number): string {
    return '#' + Math.floor((Math.abs(Math.sin(index) * 16777215)) % 16777215).toString(16);
  }

  getBounds(): LatLngBoundsLiteral {
    const pointsWithPosition = this.event.getPointsWithPosition();
    if (!pointsWithPosition.length) {
      return;
    }
    const mostEast = pointsWithPosition.reduce((acc: PointInterface, point: PointInterface) => {
      return (acc.getPosition().longitudeDegrees < point.getPosition().longitudeDegrees) ? point : acc;
    });
    const mostWest = pointsWithPosition.reduce((acc: any, point: PointInterface) => {
      return (acc.getPosition().longitudeDegrees > point.getPosition().longitudeDegrees) ? point : acc;
    });
    const mostNorth = pointsWithPosition.reduce((acc: any, point: PointInterface) => {
      return (acc.getPosition().latitudeDegrees < point.getPosition().latitudeDegrees) ? point : acc;
    });
    const mostSouth = pointsWithPosition.reduce((acc: any, point: PointInterface) => {
      return (acc.getPosition().latitudeDegrees > point.getPosition().latitudeDegrees) ? point : acc;
    });
    return <LatLngBoundsLiteral>{
      east: mostEast.getPosition().longitudeDegrees,
      west: mostWest.getPosition().longitudeDegrees,
      north: mostNorth.getPosition().latitudeDegrees,
      south: mostSouth.getPosition().latitudeDegrees
    };
  }
}
