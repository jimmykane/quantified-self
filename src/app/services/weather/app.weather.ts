import {WeatherItem} from './app.weather.item';
export class Weather {
  public date: Date;
  public weatherItems: WeatherItem[];

  constructor(weatherItems: WeatherItem[]) {
    this.weatherItems = weatherItems;
  }

  getMinTemperatureInCelsius(): number {
    return this.weatherItems.reduce((previous, weatherItem: WeatherItem) => {
      return previous.temperatureInCelsius < weatherItem.temperatureInCelsius ? previous : weatherItem;
    }).temperatureInCelsius;
  }

  getMaxTemperatureInCelsius(): number {
    return this.weatherItems.reduce((previous, weatherItem: WeatherItem) => {
      return previous.temperatureInCelsius > weatherItem.temperatureInCelsius ? previous : weatherItem;
    }).temperatureInCelsius;
  }

  getAverageTemperatureInCelsius(): number {
    return this.weatherItems.reduce((average, weatherItem: WeatherItem) => {
      return average + weatherItem.temperatureInCelsius / this.weatherItems.length
    }, 0);
  }
}
