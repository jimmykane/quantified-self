import {Injectable} from '@angular/core';
import {Event} from '../entities/events/event';
import {EventExporterTCX} from '../entities/events/adapters/exporters/exporter.tcx';
import {BehaviorSubject} from 'rxjs/BehaviorSubject';
import {List} from 'immutable';
import {Observable} from 'rxjs/Observable';
import {EventInterface} from '../entities/events/event.interface';
import {EventImporterJSON} from '../entities/events/adapters/importers/importer.json';
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
import {GeoLocationInfo} from '../entities/geo-location-info/geo-location-info';
import {Weather} from '../entities/weather/app.weather';

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

  public createEventFromJSONString(data: string): Promise<EventInterface> {
    return new Promise((resolve, reject) => {
      return resolve(EventImporterJSON.getFromJSONString(data));
    });
  }

  // public createEventFromJSONSMLString(data: string): Promise<EventInterface> {
  //   return new Promise((resolve, reject) => {
  //     return resolve(EventImporterSML.getFromJSONString(data));
  //   });
  // }

  public createEventFromSuuntoJSONString(data: string): Promise<EventInterface> {
    return new Promise((resolve, reject) => {
      return resolve(EventImporterSuuntoJSON.getFromJSONString(data));
    });
  }

  // public createEventFromJSONFITString(data: string): Promise<EventInterface> {
  //   return new Promise((resolve, reject) => {
  //     return resolve(EventImporterFIT.getFromJSONString(data));
  //   });
  // }

  public generateGeoAndWeather(event: EventInterface): Promise<EventInterface> {
    // @todo refactor this poc
    return new Promise(((resolve, reject) => {
      // Activities Summaries
      const activitiesPromises = [];
      for (const activity of event.getActivities()) {
        if (!event.hasPointsWithPosition(void 0, void 0, void 0, [activity])) {
          continue;
        }

        activitiesPromises.push(this.geoLocationInfoService.getGeoLocationInfo(
          event.getPointsWithPosition(void 0, void 0, void 0, [activity])[0].getPosition()
        ));
        activitiesPromises.push(this.weatherService.getWeather(
          event.getPointsWithPosition(void 0, void 0, void 0, [activity])[0].getPosition(), activity.startDate
        ));
      }

      Observable.forkJoin(activitiesPromises).toPromise().then(results => {
        let index = 0;
        for (const activity of event.getActivities()) {
          // If indoors
          if (!event.hasPointsWithPosition(void 0, void 0, void 0, [activity])) {
            index += 2;
            continue;
          }
          if (results[index]) {
            activity.summary.geoLocationInfo = <GeoLocationInfo> results[index];
          }
          if (results[index + 1]) {
            activity.summary.weather = <Weather> results[index + 1];
          }
          index += 2;
        }
        resolve(event);
      }).catch(() => {
        resolve(event);
      });
    }));
  }

  public generateEventSummaries(event: EventInterface): Promise<EventInterface> {
    return new Promise(((resolve, reject) => {

      // Activities Summaries
      const activitiesPromises = [];
      for (const activity of event.getActivities()) {
        const activitySummary = new Summary();
        activitySummary.totalDistanceInMeters = this.getEventDistanceInMeters(
          event, void 0, void 0, void 0, [activity]
        );

        activitySummary.totalDurationInSeconds = (+activity.endDate - +activity.startDate) / 1000;
        activity.summary = activitySummary;

        // If indoors
        if (!event.hasPointsWithPosition(void 0, void 0, void 0, [activity])) {
          continue;
        }

        // Lap summaries
        for (const lap of activity.getLaps()) {
          const lapSummary = new Summary();
          lapSummary.totalDistanceInMeters = this.getEventDistanceInMeters(event, lap.startDate, lap.endDate);
          lapSummary.totalDurationInSeconds = (+lap.endDate - +lap.startDate) / 1000;
          lap.summary = lapSummary;
        }
      }

      // Event Summary
      const eventSummary = new Summary();
      eventSummary.totalDurationInSeconds = event.getTotalDurationInSeconds();
      eventSummary.totalDistanceInMeters = this.getEventDistanceInMeters(event);
      event.summary = eventSummary;
    }));
  }

  // public createEventFromXMLString(data: string): Promise<EventInterface> {
  //   return new Promise((resolve, reject) => {
  //     // Read the xml
  //     try {
  //       const xml = this.parser.parseFromString(data, 'application/xml');
  //       if (xml.getElementsByTagName('gpx')[0]) {
  //         return resolve(EventImporterGPX.getFromXML(xml));
  //       } else if (xml.getElementsByTagName('TrainingCenterDatabase')[0]) {
  //         return resolve(EventImporterTCX.getFromXML(xml));
  //       }
  //     } catch (e) {
  //       return reject(e);
  //     }
  //     return reject('Could not fund an encoder for this file format');
  //   });
  // }

  public getEventDistanceInMeters(event: EventInterface,
                                  startDate?: Date,
                                  endDate?: Date,
                                  step?: number,
                                  activities?: ActivityInterface[]): number {
    if (!event.hasPointsWithPosition()) {
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
      if (!point.getDataByType(dataType)) {
        return average;
      }
      average += point.getDataByType(dataType).getValue();
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
      if (!previous.getDataByType(dataType)) {
        return next;
      }
      if (!next.getDataByType(dataType)) {
        return previous;
      }
      if ((previous.getDataByType(dataType).getValue() + minDiff) < (Number(next.getDataByType(dataType).getValue()))) {
        gain += Number(next.getDataByType(dataType).getValue().toFixed(precision)) - Number(previous.getDataByType(dataType).getValue().toFixed(precision));
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
      if (!previous.getDataByType(dataType)) {
        return next;
      }
      if (!next.getDataByType(dataType)) {
        return previous;
      }
      if ((Number(next.getDataByType(dataType).getValue().toFixed(precision)) - minDiff) < Number(previous.getDataByType(dataType).getValue().toFixed(precision))) {
        loss += Number(previous.getDataByType(dataType).getValue().toFixed(precision)) - Number(next.getDataByType(dataType).getValue().toFixed(precision));
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
        return +eventA.getFirstActivity().startDate - +eventB.getFirstActivity().startDate;
      });
      const mergeEvent = new Event();
      for (const event of events) {
        for (const activity of event.getActivities()) {
          mergeEvent.addActivity(activity);
        }
      }
      const eventSummary = new Summary();
      eventSummary.totalDurationInSeconds = mergeEvent.getTotalDurationInSeconds();
      eventSummary.totalDistanceInMeters = mergeEvent.getActivities().reduce(
        (totalDistance, activity) => activity.summary.totalDistanceInMeters + totalDistance, 0
      );
      mergeEvent.summary = eventSummary;
      mergeEvent.setName('Merged at ' + (new Date()).toISOString());
      return resolve(mergeEvent);
    });
  }
}
