import {WeatherItem} from './app.weather.item';

describe('WeatherItem', () => {

  let weatherItem: WeatherItem;

  beforeEach(() => {
    weatherItem = new WeatherItem(new Date(0), 'test', 0)
  });

  it('should export correctly to JSON', () => {
    expect(weatherItem.toJSON()).toEqual({
      'date': '1970-01-01T00:00:00.000Z',
      'conditions': 'test',
      'temperatureInCelsius': 0
    });
  });

});
