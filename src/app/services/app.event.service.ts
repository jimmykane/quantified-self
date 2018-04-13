import {Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs/BehaviorSubject';
import {List} from 'immutable';
import {Observable} from 'rxjs/Observable';
import {EventInterface} from '../entities/events/event.interface';
import {EventLocalStorageService} from './storage/app.event.local.storage.service';
import {GeoLocationInfoService} from './geo-location/app.geo-location-info.service';
import {WeatherUndergroundWeatherService} from './weather/app.weather-underground.weather.service';
import 'rxjs/add/observable/forkJoin';
import {GeoLocationInfo} from '../entities/geo-location-info/geo-location-info';
import {Weather} from '../entities/weather/app.weather';
import {EventImporterJSON} from '../entities/events/adapters/importers/importer.json';

@Injectable()
export class EventService {

  private events: BehaviorSubject<List<EventInterface>> = new BehaviorSubject(List([]));

  constructor(private eventLocalStorageService: EventLocalStorageService,
              private weatherService: WeatherUndergroundWeatherService,
              private geoLocationInfoService: GeoLocationInfoService) {
    // Fetch existing events
    this.getInitialData();
  }

  private getInitialData() {
    for (const localStorageKey of this.eventLocalStorageService.getAllKeys()) {
      this.eventLocalStorageService.getItem(localStorageKey).then((localStorageData) => {
        this.events.next(this.events.getValue().push(EventImporterJSON.getFromJSONString(localStorageData)));
      });
    }
  }

  public addAndSaveEvent(event: EventInterface) {
    this.saveEvent(event).then((result) => {
      this.events.next(this.events.getValue().push(event));
    });
  }

  public addAndSaveEvents(events: EventInterface[]) {
    for (const event of events) {
      this.addAndSaveEvent(event);
    }
  }

  public saveEvent(event: EventInterface): Promise<boolean> {
    return this.eventLocalStorageService.setItem(event.getID(), JSON.stringify(event));
  }

  public deleteEvent(eventToDelete: EventInterface) {
    this.eventLocalStorageService.removeItem(eventToDelete.getID()).then(() => {
      this.events.next(this.events.getValue().delete(this.events.getValue().findIndex((event: EventInterface) => {
        return eventToDelete.getID() === event.getID();
      })));
    });
  }

  public getEvents(): Observable<List<EventInterface>> {
    return this.events.asObservable();
  }

  public generateGeoAndWeather(event: EventInterface): Promise<EventInterface> {
    // @todo refactor this poc
    return new Promise(((resolve, reject) => {
      // Activities Stats
      const activitiesPromises = [];
      for (const activity of event.getActivities()) {
        if (!event.hasPointsWithPosition(void 0, void 0, [activity])) {
          continue;
        }

        activitiesPromises.push(this.geoLocationInfoService.getGeoLocationInfo(
          event.getPointsWithPosition(void 0, void 0, [activity])[0].getPosition()
        ));
        activitiesPromises.push(this.weatherService.getWeather(
          event.getPointsWithPosition(void 0, void 0, [activity])[0].getPosition(), activity.startDate
        ));
      }

      Observable.forkJoin(activitiesPromises).toPromise().then(results => {
        let index = 0;
        for (const activity of event.getActivities()) {
          // If indoors
          if (!event.hasPointsWithPosition(void 0, void 0, [activity])) {
            index += 2;
            continue;
          }
          if (results[index]) {
            activity.geoLocationInfo = <GeoLocationInfo> results[index];
          }
          if (results[index + 1]) {
            activity.weather = <Weather> results[index + 1];
          }
          index += 2;
        }
        resolve(event);
      }).catch(() => {
        resolve(event);
      });
    }));
  }
}
