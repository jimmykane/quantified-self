export class WeatherItem {
  public date: Date;
  public conditions: string;
  public temperatureInCelsius;

  constructor(date: Date, conditions: string, temperatureInCelsius: number) {
    this.date = date;
    this.conditions = conditions;
    this.temperatureInCelsius = temperatureInCelsius;
  }
}
