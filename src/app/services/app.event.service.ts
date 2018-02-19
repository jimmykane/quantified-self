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
import {WeatherUndergroundWeatherService} from './weather/app.weather-underground.weather.service';
import {EventImporterSuuntoJSON} from '../entities/events/adapters/importers/importer.suunto.json';
import 'rxjs/add/observable/forkJoin';
import {ActivityInterface} from '../entities/activities/activity.interface';
import {GeoLibAdapter} from '../entities/geodesy/adapters/geolib.adapter';
import {PointInterface} from '../entities/points/point.interface';
import {Log} from 'ng2-logger';
import {Summary} from '../entities/summary/summary';
import {ActivitySummary} from "../entities/activities/activity.summary";
import {GeoLocationInfo} from "../entities/geo-location-info/app.geo-location-info";
import {Weather} from "../entities/weather/app.weather";

@Injectable()
export class EventService {

  private parser: DOMParser = new DOMParser;
  private events: BehaviorSubject<List<EventInterface>> = new BehaviorSubject(List([]));
  private geodesyAdapter = new GeoLibAdapter();
  private logger = Log.create('EventService');

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

  public createEventFromSuuntoJSONString(data: string): Promise<EventInterface> {
    return new Promise((resolve, reject) => {
      return resolve(EventImporterSuuntoJSON.getFromJSONString(data));
    });
  }

  public createEventFromJSONFITString(data: string): Promise<EventInterface> {
    return new Promise((resolve, reject) => {
      return resolve(EventImporterFIT.getFromJSONString(data));
    });
  }

  public generateEventSummaries(event: EventInterface): Promise<EventInterface> {
    return new Promise(((resolve, reject) => {
      // Lap summaries
      for (const lap of event.getLaps()) {
        const lapSummary = new Summary();
        lapSummary.setTotalDistanceInMeters(this.getEventDistanceInMeters(event, lap.getStartDate(), lap.getEndDate()));
        lapSummary.setTotalDurationInSeconds((+lap.getEndDate() - +lap.getStartDate()) / 1000);
        lap.setSummary(lapSummary);
      }

      // Activities Summaries
      const activitiesPromises = [];
      for (const activity of event.getActivities()) {
        const activitySummary = new ActivitySummary();
        activitySummary.setTotalDistanceInMeters(
          this.getEventDistanceInMeters(event, void 0, void 0, void 0, [activity])
        );
        activitySummary.setTotalDurationInSeconds((+activity.getEndDate() - +activity.getStartDate()) / 1000);
        activity.setSummary(activitySummary);

        // If indoors
        if (!event.getPointsWithPosition(void 0, void 0, void 0, [activity]).length) {
          continue;
        }

        activitiesPromises.push(this.geoLocationInfoService.getGeoLocationInfo(
          event.getPointsWithPosition(void 0, void 0, void 0, [activity])[0].getPosition()
        ));
        activitiesPromises.push(this.weatherService.getWeather(
          event.getPointsWithPosition(void 0, void 0, void 0, [activity])[0].getPosition(), activity.getStartDate()
        ));
      }

      // Event Summary
      const eventSummary = new Summary();
      eventSummary.setTotalDurationInSeconds(event.getTotalDurationInSeconds());
      eventSummary.setTotalDistanceInMeters(this.getEventDistanceInMeters(event));
      event.setSummary(eventSummary);

      Observable.forkJoin(activitiesPromises).toPromise().then(results => {
        let index = 0;
        for (const activity of event.getActivities()) {
          // If indoors
          if (!event.getPointsWithPosition(void 0, void 0, void 0, [activity]).length) {
            index += 2;
            continue;
          }
          if (results[index]) {
            activity.getSummary().setGeoLocationInfo(<GeoLocationInfo> results[index]);
          }
          if (results[index + 1]) {
            activity.getSummary().setWeather(<Weather> results[index + 1]);
          }
          index += 2;
        }
        resolve(event);
      }).catch(() => {
        resolve(event);
      });
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

  public getEventDistanceInMeters(event: EventInterface,
                                  startDate?: Date,
                                  endDate?: Date,
                                  step?: number,
                                  activities?: ActivityInterface[]): number {
    if (!event.getPointsWithPosition().length) {
      return 0;
    }
    return event.getActivities().reduce((distance: number, activity: ActivityInterface) => {
      return distance + this.geodesyAdapter.getDistance(event.getPointsWithPosition(void 0, void 0, void 0, [activity]));
    }, 0);
  }

  public getEventDataTypeAverage(event: EventInterface,
                                 dataType: string,
                                 startDate?: Date,
                                 endDate?: Date,
                                 step?: number,
                                 activities?: ActivityInterface[]): number {
    const t0 = performance.now();
    let count = 1;
    const averageForDataType = event.getPoints(startDate, endDate, step, activities).reduce((average: number, point: PointInterface) => {
      if (!point.getDataTypeAverage(dataType)) { // @todo should check against void 0
        return average;
      }
      average += point.getDataTypeAverage(dataType);
      count++;
      return average;
    }, 0);
    this.logger.d('Calculated average for ' + dataType + ' after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return averageForDataType / count;
  }

  public getEventDataTypeGain(event: EventInterface,
                              dataType: string,
                              startDate?: Date,
                              endDate?: Date,
                              step?: number,
                              activities?: ActivityInterface[],
                              precision?: number,
                              minDiff?: number): number {
    const t0 = performance.now();
    precision = precision || 1;
    minDiff = minDiff || 1.5;
    let gain = 0;
    event.getPoints(startDate, endDate, step, activities).reduce((previous: PointInterface, next: PointInterface) => {
      if (!previous.getDataTypeAverage(dataType)) {
        return next;
      }
      if (!next.getDataTypeAverage(dataType)) {
        return previous;
      }
      if ((previous.getDataTypeAverage(dataType) + minDiff) < (Number(next.getDataTypeAverage(dataType)))) {
        gain += Number(next.getDataTypeAverage(dataType).toFixed(precision)) - Number(previous.getDataTypeAverage(dataType).toFixed(precision));
      }
      return next;
    });
    this.logger.d('Calculated gain for ' + dataType + ' after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return gain;
  }

  public getEventDataTypeLoss(event: EventInterface,
                              dataType: string,
                              startDate?: Date,
                              endDate?: Date,
                              step?: number,
                              activities?: ActivityInterface[],
                              precision?: number,
                              minDiff?: number): number {
    const t0 = performance.now();
    precision = precision || 1;
    minDiff = minDiff || 1.5;
    let loss = 0;
    event.getPoints(startDate, endDate, step, activities).reduce((previous: PointInterface, next: PointInterface) => {
      if (!previous.getDataTypeAverage(dataType)) {
        return next;
      }
      if (!next.getDataTypeAverage(dataType)) {
        return previous;
      }
      if ((Number(next.getDataTypeAverage(dataType).toFixed(precision)) - minDiff) < Number(previous.getDataTypeAverage(dataType).toFixed(precision))) {
        loss += Number(previous.getDataTypeAverage(dataType).toFixed(precision)) - Number(next.getDataTypeAverage(dataType).toFixed(precision));
      }
      return next;
    });
    this.logger.d('Calculated loss for ' + dataType + ' after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return loss;
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
