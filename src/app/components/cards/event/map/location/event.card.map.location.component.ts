import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges} from '@angular/core';
import {MapsAPILoader} from '@agm/core';
import {DataPositionInterface} from '../../../../../entities/data/data.position.interface';

declare const google: any;


@Component({
  selector: 'app-card-map-location',
  templateUrl: './event.card.map.location.component.html',
  styleUrls: ['./event.card.map.location.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardMapLocationComponent implements OnChanges {
  @Input() position: DataPositionInterface;
  public country: string;
  public city: string;
  public province: string;

  constructor(private changeDetectorRef: ChangeDetectorRef, private mapsAPILoader: MapsAPILoader) {
  }

  ngOnChanges() {
    this.mapsAPILoader.load().then(() => {
      // @todo cache this and cast to private
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({
        'location': {
          lat: this.position.latitudeDegrees,
          lng: this.position.longitudeDegrees
        }
      }, this.processReverseGeocodeResults);
    });
  }

  private processReverseGeocodeResults = (results, status) => {
    if (!status === google.maps.GeocoderStatus.OK || !results[0].address_components) {
      return;
    }
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
        case 'administrative_area_level_1': {
          this.province = addressComponent.long_name;
          break;
        }
      }
    });
    this.changeDetectorRef.detectChanges();
  };
}

