import {Weather} from '../../entities/weather/app.weather';
import {DataPositionInterface} from '../../entities/data/data.position.interface';

export interface WeatherServiceInterface {
  getWeather(position: DataPositionInterface, date: Date): Promise<Weather>;
}
