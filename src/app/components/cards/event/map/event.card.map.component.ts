import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnInit,
  ViewChild
} from '@angular/core';
import seedColor from 'seed-color';
import {AgmMap, GoogleMapsAPIWrapper, LatLngBoundsLiteral, LatLngLiteral} from '@agm/core';
import {PointInterface} from '../../../../entities/points/point.interface';
import {EventInterface} from '../../../../entities/events/event.interface';
import {Log} from 'ng2-logger';
import {GoogleMap} from '@agm/core/services/google-maps-types';

declare const google: any;


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

  private logger = Log.create(this.constructor.name);

  constructor(private changeDetectorRef: ChangeDetectorRef, private googleMapsWrapper: GoogleMapsAPIWrapper) {
  }

  ngOnInit() {
  }

  ngOnChanges() {
    // @todo maybe this can be done in a different way
    if (this.resize) {
      this.agmMap.triggerResize().then(() => {
        this.agmMap._mapsWrapper.fitBounds(this.getBounds())
      });
    }
  }

  getActivityColor(seed: string): string {
    return seedColor(seed).toHex();
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
