import {WeatherItem} from './app.weather.item';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';

export class Weather implements SerializableClassInterface {
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

  toJSON(): any {
    return {
      weatherItems: this.weatherItems
    };
  }
}
