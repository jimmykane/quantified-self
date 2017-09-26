import {SerializableClassInterface} from '../serializable/serializable.class.interface';

export class WeatherItem implements SerializableClassInterface{
  public date: Date;
  public conditions: string;
  public temperatureInCelsius;

  constructor(date: Date, conditions: string, temperatureInCelsius: number) {
    this.date = date;
    this.conditions = conditions;
    this.temperatureInCelsius = temperatureInCelsius;
  }

  toJSON(): any {
    return {
      date: this.date.toISOString(),
      conditions: this.conditions,
      temperatureInCelsius: this.temperatureInCelsius
    }
  }
}
