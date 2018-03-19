import {WeatherItem} from './app.weather.item';
import {Weather} from './app.weather';

describe('Weather', function () {

  let weather: Weather;

  beforeEach(() => {
    weather = new Weather(
      [
        new WeatherItem(
          new Date(0),
          'Test',
          0
        ),
        new WeatherItem(
          new Date(0),
          'Test',
          2
        ),
        new WeatherItem(
          new Date(0),
          'Test',
          4
        )
      ]
    )
  });

  it('should be able to find the min temperature', function () {
    expect(weather.getMinTemperatureInCelsius()).toBe(0);
  });

  it('should be able to find the max temperature', function () {
    expect(weather.getMaxTemperatureInCelsius()).toBe(4);
  });

  it('should be able to find the avg temperature', function () {
    expect(weather.getAverageTemperatureInCelsius()).toBe((2 + 4) / 3);
  });


  it('should export correctly to JSON', function () {
    expect(weather.toJSON()).toEqual({
      'weatherItems': [
        {
          'date': '1970-01-01T00:00:00.000Z',
          'conditions': 'Test',
          'temperatureInCelsius': 0
        },
        {
          'date': '1970-01-01T00:00:00.000Z',
          'conditions': 'Test',
          'temperatureInCelsius': 2
        },
        {
          'date': '1970-01-01T00:00:00.000Z',
          'conditions': 'Test',
          'temperatureInCelsius': 4
        }
      ]
    });

  });
});
