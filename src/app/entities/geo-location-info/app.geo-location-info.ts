export class GeoLocationInfo {
  public latitude: number;
  public longitude: number;
  public city: string;
  public country: string;
  public province: string;

  constructor(latitude: number, longitude: number) {
    this.latitude = latitude;
    this.longitude = longitude;
  }
}
