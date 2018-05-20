import {Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs/BehaviorSubject';
import {List} from 'immutable';
import {Observable} from 'rxjs/Observable';
import {EventLocalStorageService} from './storage/app.event.local.storage.service';
import {GeoLocationInfoService} from './geo-location/app.geo-location-info.service';
import {WeatherUndergroundWeatherService} from './weather/app.weather-underground.weather.service';
import 'rxjs/add/observable/forkJoin';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {GeoLocationInfo} from 'quantified-self-lib/lib/geo-location-info/geo-location-info';
import {Weather} from 'quantified-self-lib/lib/weather/app.weather';
import {DataPositionInterface} from 'quantified-self-lib/lib/data/data.position.interface';
import {EventImporterJSON} from 'quantified-self-lib/lib/events/adapters/importers/json/importer.json';
import * as Raven from 'raven-js';

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
        try {
          this.events.next(this.events.getValue().push(EventImporterJSON.getFromJSONString(localStorageData)));
        } catch (e) {
          Raven.captureException(e);
          console.error(e);
          this.eventLocalStorageService.removeItem(localStorageKey).then(() => console.log(`Removed event with id: ${localStorageKey}`));
        }
      });
    }
  }

  public addEvent(event: EventInterface) {
    // If the event is already in the list create a new one as of update
    if (this.findEvent(event.getID())) {
      this.deleteEvent(event); // Delete first
      event = EventImporterJSON.getFromJSONString(JSON.stringify(event)); // Create new obj to trigger change detection
    }
    // Set to local storage and to list
    this.eventLocalStorageService.setItem(event.getID(), JSON.stringify(event));
    this.events.next(this.events.getValue().push(event));
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

  public findEvent(eventID: string): EventInterface {
    return this.events.getValue().find((event: EventInterface) => {
      return event.getID() === eventID;
    });
  }

  /**
   * Add geolocation and weather info to an event
   * @param {EventInterface} event
   * @return {Promise<EventInterface>}
   * @todo Write tests!
   */
  public addGeoLocationAndWeatherInfo(event: EventInterface): Promise<EventInterface> {
    return new Promise(((resolve, reject) => {
      // Find the activities with positional data
      const activitiesWithPosition = event.getActivities().filter((activity) => {
        return event.getPointsWithPosition(void 0, void 0, [activity]).length
      });
      // Create their promises
      const activitiesPromises = activitiesWithPosition.reduce((activityPromises, activity) => {
        activityPromises.push(this.geoLocationInfoService.getGeoLocationInfo(
          <DataPositionInterface>event.getPointsWithPosition(void 0, void 0, [activity])[0].getPosition(),
        ));
        activityPromises.push(this.weatherService.getWeather(
          <DataPositionInterface>event.getPointsWithPosition(void 0, void 0, [activity])[0].getPosition(), activity.startDate,
        ));
        return activityPromises;
      }, []);

      // Wait for all
      Promise.all(activitiesPromises.map(p => p.catch(e => e))).then(results => {
        if (!results || !results.length) {
          resolve(event);
        }
        // For each activity get 2 data from the results
        let i = 0;
        activitiesWithPosition.forEach((activity, index) => {
          if (results[index + i] instanceof GeoLocationInfo) {
            activity.geoLocationInfo = <GeoLocationInfo> results[index + i];
          }
          if (results[index + i + 1] instanceof Weather) {
            activity.weather = <Weather> results[index + i + 1];
          }
          i += 2;
        });
        resolve(event);
      }).catch((e) => {
        reject(event);
      });
    }));
  }
}
