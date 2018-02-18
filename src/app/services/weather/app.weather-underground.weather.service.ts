import {Injectable} from '@angular/core';
import {Http} from '@angular/http';
import {Observable} from 'rxjs/Observable';
import {EventInterface} from '../../entities/events/event.interface';
import {WeatherItem} from '../../entities/weather/app.weather.item';
import {Weather} from '../../entities/weather/app.weather';
import {WeatherServiceInterface} from 'app/services/weather/app.weather.service.interface';
import {map} from 'rxjs/operators'
import {reject} from "q";
import {DataPositionInterface} from "../../entities/data/data.position.interface";

@Injectable()
export class WeatherUndergroundWeatherService implements WeatherServiceInterface {

  private historyApiUrl = 'https://api.wunderground.com/api/{apiKey}/history_{YYYYMMDD}/q/{lat},{lon}.json';
  private apiKey = 'a6dbe6951244fa18';

  constructor(private http: Http) {
  }

  getWeather(position: DataPositionInterface, date: Date): Observable<Weather> {
    return this.http
      .get(
        this.historyApiUrl
          .replace('{lat}', position.latitudeDegrees.toString())
          .replace('{lon}', position.longitudeDegrees.toString())
          .replace('{YYYYMMDD}', date.toISOString().slice(0, 10).replace(/-/g, ''))
          .replace('{apiKey}', this.apiKey)
      ).pipe(map((response) => {
        const jsonResponse = JSON.parse(response.text());
        if (jsonResponse.response.error) {
          reject();
        }
        const weatherItemsMap: Map<string, WeatherItem> = jsonResponse
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
      }));
  }
}
