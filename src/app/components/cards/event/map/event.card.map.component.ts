import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, ViewChild} from '@angular/core';
import seedColor from 'seed-color';
import {AgmMap, GoogleMapsAPIWrapper, LatLngBoundsLiteral, LatLngLiteral} from '@agm/core';
import {PointInterface} from '../../../../entities/points/point.interface';
import {EventInterface} from '../../../../entities/events/event.interface';
import {Log} from "ng2-logger";
import {GoogleMap} from "@agm/core/services/google-maps-types";

declare var google: any;


@Component({
  selector: 'app-event-card-map',
  templateUrl: './event.card.map.component.html',
  styleUrls: ['./event.card.map.component.css'],
  providers: [GoogleMapsAPIWrapper],
  // changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardMapComponent {
  @Input() event: EventInterface;
  @ViewChild(AgmMap) agmMap;
  city: string;
  country: string;

  private logger = Log.create(this.constructor.name);

  constructor(private changeDetectorRef: ChangeDetectorRef, private googleMapsWrapper: GoogleMapsAPIWrapper) {
  }

  fitBounds(): LatLngBoundsLiteral {
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


  getActivityColor(seed: string): string {
    return seedColor(seed).toHex();
  }

  ngOnChanges() {
    this.agmMap._mapsWrapper.getNativeMap().then((map: GoogleMap) => {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({
        'location': {
          lat: this.event.getFirstActivity().getStartPoint().getPosition().latitudeDegrees,
          lng: this.event.getFirstActivity().getStartPoint().getPosition().longitudeDegrees
        }
      }, this.processReverseGeocodeResults);
    });
  }

  private processReverseGeocodeResults = (results, status) => {
    if (status === google.maps.GeocoderStatus.OK) {
      results[0].address_components.forEach((addressComponent) => {
        switch (addressComponent.types[0]) {
          case 'country': {
            this.country = addressComponent.long_name;
            break;
          }
          case 'locality': {
            this.city = addressComponent.long_name;
            break;
          }
        }
      });
      this.changeDetectorRef.detectChanges();
    } else {
      debugger;
      console.log('Error - ', results, ' & Status - ', status);
    }
  }

}
