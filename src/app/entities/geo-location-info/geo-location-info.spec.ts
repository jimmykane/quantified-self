import {GeoLocationInfo} from './geo-location-info';

describe('GeoLocationInfo', () => {

  let geoLocationInfo: GeoLocationInfo;

  beforeEach(() => {
    geoLocationInfo = new GeoLocationInfo(0, 0);
  });

  it('should export correctly to JSON', () => {
    geoLocationInfo.city = 'Buzan';
    geoLocationInfo.province = 'Ariege';
    geoLocationInfo.country = 'France';
    expect(geoLocationInfo.toJSON()).toEqual({
      'latitude': 0,
      'longitude': 0,
      'city': 'Buzan',
      'country': 'France',
      'province': 'Ariege'
    });

  });
});
