import {DataPositionInterface} from 'quantified-self-lib/lib/data/data.position.interface';
import {Weather} from 'quantified-self-lib/lib/weather/app.weather';

export interface WeatherServiceInterface {
  getWeather(position: DataPositionInterface, date: Date): Promise<Weather>;
}
