import {Injectable} from '@angular/core';
import {Event} from '../entities/events/event';
import {EventImporterTCX} from '../entities/events/adapters/importers/importer.tcx';
import {EventExporterTCX} from '../entities/events/adapters/exporters/exporter.tcx';
import {EventImporterGPX} from '../entities/events/adapters/importers/importer.gpx';
import {BehaviorSubject} from 'rxjs/BehaviorSubject';
import {List} from 'immutable';
import {Observable} from 'rxjs/Observable';
import {Activity} from '../entities/activities/activity';
import {EventInterface} from '../entities/events/event.interface';
import {EventImporterJSON} from '../entities/events/adapters/importers/importer.json';
import {EventImporterSML} from '../entities/events/adapters/importers/importer.sml';
import {EventImporterFIT} from '../entities/events/adapters/importers/importer.fit';
import {EventLocalStorageService} from './storage/app.event.local.storage.service';
import {GeoLocationInfoService} from './geo-location/app.geo-location-info.service';
import 'rxjs/add/observable/forkJoin';
import {WeatherUndergroundWeatherService} from './weather/app.weather-underground.weather.service';
import {EventSummary} from '../entities/events/summary/event.summary';
import 'rxjs/add/operator/toPromise';

@Injectable()
export class EventService {

  private parser: DOMParser = new DOMParser;
  private events: BehaviorSubject<List<EventInterface>> = new BehaviorSubject(List([]));

  public static getEventAsTCXBloB(event: EventInterface): Promise<Blob> {
    return new Promise((resolve, reject) => {
      resolve(new Blob(
        [(new EventExporterTCX).getAsString(event)],
        {type: (new EventExporterTCX).getFileType()}
      ));
    });
  }

  constructor(private eventLocalStorageService: EventLocalStorageService,
              private weatherService: WeatherUndergroundWeatherService,
              private geoLocationInfoService: GeoLocationInfoService) {
    // Fetch existing events
    this.getInitialData();
  }

  private getInitialData() {
    for (const localStorageKey of this.eventLocalStorageService.getAllKeys()) {
      this.eventLocalStorageService.getItem(localStorageKey).then((localStorageData) => {
        this.createEventFromJSONString(localStorageData).then((event: EventInterface) => {
          this.generateEventSummary(event);

          this.events.next(this.events.getValue().push(event));
        });
      });
    }
  }

  public saveEvent(event: EventInterface) {
    this.eventLocalStorageService.setItem(event.getID(), JSON.stringify(event)).then((result) => {
      this.events.next(this.events.getValue().push(event));
    });
  }

  public addEvents(events: EventInterface[]) {
    for (const event of events) {
      this.saveEvent(event);
    }
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

  public createEventFromJSONString(data: string): Promise<EventInterface> {
    return new Promise((resolve, reject) => {
      return resolve(EventImporterJSON.getFromJSONString(data));
    });
  }

  public createEventFromJSONSMLString(data: string): Promise<EventInterface> {
    return new Promise((resolve, reject) => {
      return resolve(EventImporterSML.getFromJSONString(data));
    });
  }

  public createEventFromJSONFITString(data: string): Promise<EventInterface> {
    return new Promise((resolve, reject) => {
      return resolve(EventImporterFIT.getFromJSONString(data));
    });
  }

  public generateEventSummary(event: EventInterface): any {
    const eventSummary = new EventSummary();
    eventSummary.setTotalDurationInSeconds(event.getTotalDurationInSeconds());
    eventSummary.setTotalDistanceInMeters(event.getDistanceInMeters());
    return new Promise(((resolve, reject) => {
      Observable.forkJoin([
        this.geoLocationInfoService.getGeoLocationInfo(event).first(), this.weatherService.getWeatherForEvent(event).first()
      ]).toPromise().then(results => {
        eventSummary.setGeoLocationInfo(results[0]);
        eventSummary.setWeather(results[1]);
        event.setSummary(eventSummary);
        debugger;
        resolve(event);
      })
    }));
  }

  public createEventFromXMLString(data: string): Promise<EventInterface> {
    return new Promise((resolve, reject) => {
      // Read the xml
      try {
        const xml = this.parser.parseFromString(data, 'application/xml');
        if (xml.getElementsByTagName('gpx')[0]) {
          return resolve(EventImporterGPX.getFromXML(xml));
        } else if (xml.getElementsByTagName('TrainingCenterDatabase')[0]) {
          return resolve(EventImporterTCX.getFromXML(xml));
        }
      } catch (e) {
        return reject(e);
      }
      return reject('Could not fund an encoder for this file format');
    });
  }

  public mergeEvents(events: EventInterface[]): Promise<EventInterface> {
    return new Promise((resolve, reject) => {
      // First sort the events by first point date
      events.sort((eventA: EventInterface, eventB: EventInterface) => {
        return +eventA.getFirstActivity().getStartDate() - +eventB.getFirstActivity().getStartDate();
      });
      const mergeEvent = new Event();
      mergeEvent.setName((new Date()).toISOString());
      for (const event of events) {
        for (const activity of event.getActivities()) {
          mergeEvent.addActivity(activity);
        }
      }
      return resolve(mergeEvent);
    });
  }

  public mergeAllEventActivities(event: EventInterface): Promise<EventInterface> {
    return new Promise((resolve, reject) => {
      // Copy the date
      const dateCopy = Object.create(event.getFirstActivity().getStartDate());
      // Copy the points
      const pointsCopy = Object.create(event.getPoints());

      // Remove all activities
      const activities = event.getActivities();
      for (let i = activities.length; i--;) {
        event.removeActivity(activities[i]);
      }
      const newActivity = new Activity();
      event.addActivity(newActivity);
      for (const point of pointsCopy) {
        newActivity.addPoint(point);
      }
      return resolve(event);
    });
  }
}
