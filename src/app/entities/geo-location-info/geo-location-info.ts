import {SerializableClassInterface} from '../serializable/serializable.class.interface';

export class GeoLocationInfo implements SerializableClassInterface {
  public latitude: number;
  public longitude: number;
  public city: string;
  public country: string;
  public province: string;

  constructor(latitude: number, longitude: number) {
    this.latitude = latitude;
    this.longitude = longitude;
  }

  toJSON(): any {
    return {
      latitude: this.latitude,
      longitude: this.longitude,
      city: this.city,
      country: this.country,
      province: this.province,
    };
  }
}
