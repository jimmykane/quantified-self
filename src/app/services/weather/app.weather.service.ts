import {Injectable} from '@angular/core';
import {Http} from '@angular/http';
import {Observable} from 'rxjs/Observable';
import {EventInterface} from '../../entities/events/event.interface';
import {WeatherItem} from './app.weather.item';


@Injectable()
export class WeatherService {

  private historyApiUrl = 'http://api.wunderground.com/api/{apiKey}/history_{YYYYMMDD}/q/{lat},{lon}.json';
  private apiKey = 'a6dbe6951244fa18';

  constructor(private http: Http) {
  }

  getWeatherForEvent(event: EventInterface): Observable<WeatherItem[]> {
    return this.http
      .get(this.historyApiUrl
        .replace('{lat}', event.getFirstActivity().getStartPoint().getPosition().latitudeDegrees.toString())
        .replace('{lon}', event.getFirstActivity().getStartPoint().getPosition().longitudeDegrees.toString())
        .replace('{YYYYMMDD}', event.getFirstActivity().getStartDate().toISOString().slice(0, 10).replace(/-/g, ''))
        .replace('{apiKey}', this.apiKey))
      .map((response) => {
        const jsonReply = JSON.parse(response.text());
        return jsonReply.history.observations.reduce((weatherItems: WeatherItem[], observation: any) => {
          if (Number(observation.date.hour) >= event.getFirstActivity().getStartDate().getHours() &&
            Number(observation.date.hour) <= event.getLastActivity().getEndDate().getHours()) {
            if (Number(observation.tempm) !== -9999) {
              const weatherItemDate =  new Date(event.getFirstActivity().getStartDate().getTime());
              weatherItemDate.setHours(Number(observation.date.hour));
              weatherItems.push(new WeatherItem(
                weatherItemDate,
                observation.conds,
                Number(observation.tempm))
              )
            }
          }
          return weatherItems;
        }, [])
      })
  }
}
