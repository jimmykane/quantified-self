import {Injectable} from '@angular/core';
import {WeatherItem} from '../../entities/weather/app.weather.item';
import {Weather} from '../../entities/weather/app.weather';
import {WeatherServiceInterface} from 'app/services/weather/app.weather.service.interface';
import {map} from 'rxjs/operators'
import {reject} from 'q';
import {DataPositionInterface} from '../../entities/data/data.position.interface';
import {HttpClient} from '@angular/common/http';

@Injectable()
export class WeatherUndergroundWeatherService implements WeatherServiceInterface {

  private historyApiUrl = 'https://api.wunderground.com/api/{apiKey}/history_{YYYYMMDD}/q/{lat},{lon}.json';
  private apiKey = 'a6dbe6951244fa18';

  constructor(private http: HttpClient) {
  }

  getWeather(position: DataPositionInterface, date: Date): Promise<Weather> {
    return this.http
      .get(
        this.historyApiUrl
          .replace('{lat}', position.latitudeDegrees.toString())
          .replace('{lon}', position.longitudeDegrees.toString())
          .replace('{YYYYMMDD}', date.toISOString().slice(0, 10).replace(/-/g, ''))
          .replace('{apiKey}', this.apiKey)
      ).pipe(map((response: any) => {
        if (response.response.error) {
          reject();
        }
        const weatherItemsMap: Map<string, WeatherItem> = response
          .history
          .observations
          .reduce(
            (weatherItems: Map<string, WeatherItem>, observation: any) => {
              if (Number(observation.date.hour) >= date.getHours() &&
                Number(observation.date.hour) <= date.getHours() &&
                Number(observation.tempm) !== -9999) {
                const weatherItemDate = new Date(date.getTime());
                weatherItemDate.setHours(Number(observation.date.hour));
                weatherItems.set(weatherItemDate.toISOString(), new WeatherItem(
                  weatherItemDate,
                  observation.conds,
                  Number(observation.tempm))
                )
              }
              return weatherItems;
            }, new Map<string, WeatherItem>()
          );
        return new Weather(
          Array.from(weatherItemsMap.values())
        );
      })).toPromise();
  }
}
