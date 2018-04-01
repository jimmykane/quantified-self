import {EventImporterSuuntoJSON} from '../adapters/importers/importer.suunto.json';
import {EventInterface} from '../event.interface';
import {EventImporterJSON} from '../adapters/importers/importer.json';
import {Summary} from '../../summary/summary';
import {ActivityInterface} from '../../activities/activity.interface';
import {GeoLibAdapter} from '../../geodesy/adapters/geolib.adapter';
import {EventExporterTCX} from '../adapters/exporters/exporter.tcx';
import {PointInterface} from "../../points/point.interface";
import {Event} from "../event";
import {LapInterface} from "../../laps/lap.interface";
import {DataHeartRate} from "../../data/data.heart-rate";
import {DataCadence} from "../../data/data.cadence";
import {DataSpeed} from "../../data/data.speed";
import {DataVerticalSpeed} from "../../data/data.verticalspeed";
import {DataTemperature} from "../../data/data.temperature";
import {DataAltitude} from "../../data/data.altitude";

export class EventUtilities {

  private static geodesyAdapter = new GeoLibAdapter();


  public static createEventFromSuuntoJSONString(data: string): Promise<EventInterface> {
    return new Promise((resolve, reject) => {
      return resolve(EventImporterSuuntoJSON.getFromJSONString(data));
    });
  }

  public static createEventFromJSONString(data: string): Promise<EventInterface> {
    return new Promise((resolve, reject) => {
      return resolve(EventImporterJSON.getFromJSONString(data));
    });
  }

  public static getEventDistanceInMeters(event: EventInterface,
                                         startDate?: Date,
                                         endDate?: Date,
                                         activities?: ActivityInterface[]): number {
    if (!event.hasPointsWithPosition()) {
      return 0;
    }
    return event.getActivities().reduce((distance: number, activity: ActivityInterface) => {
      return distance + this.geodesyAdapter.getDistance(event.getPointsWithPosition(void 0, void 0, [activity]));
    }, 0);
  }

  public static getEventAsTCXBloB(event: EventInterface): Promise<Blob> {
    return new Promise((resolve, reject) => {
      resolve(new Blob(
        [(new EventExporterTCX).getAsString(event)],
        {type: (new EventExporterTCX).getFileType()}
      ));
    });
  }

  public static getDataTypeAverage(event: EventInterface,
                                   dataType: string,
                                   startDate?: Date,
                                   endDate?: Date,
                                   activities?: ActivityInterface[]): number {
    let count = 0;
    const averageForDataType = event.getPoints(startDate, endDate, activities).reduce((average: number, point: PointInterface) => {
      if (!point.getDataByType(dataType)) {
        return average;
      }
      average += point.getDataByType(dataType).getValue();
      count++;
      return average;
    }, 0);
    return count ?  averageForDataType / (count + 1) : void 0;
  }

  public static getDateTypeMaximum(event: EventInterface,
                                   dataType: string,
                                   startDate?: Date,
                                   endDate?: Date,
                                   activities?: ActivityInterface[]): number {

    const dataValuesArray = event.getPoints(startDate, endDate, activities).reduce((dataValues, point: PointInterface) => {
      if (point.getDataByType(dataType)) {
        dataValues.push(point.getDataByType(dataType).getValue());
      }
      return dataValues;
    }, []);
    return dataValuesArray.length ? Math.max(...dataValuesArray) : void 0;
  }

  public static getDateTypeMinimum(event: EventInterface,
                                   dataType: string,
                                   startDate?: Date,
                                   endDate?: Date,
                                   activities?: ActivityInterface[]): number {

    const dataValuesArray = event.getPoints(startDate, endDate, activities).reduce((dataValues, point: PointInterface) => {
      if (point.getDataByType(dataType)) {
        dataValues.push(point.getDataByType(dataType).getValue());
      }
      return dataValues;
    }, []);
    return dataValuesArray.length ? Math.min(...dataValuesArray) : void 0;
  }

  public static getEventDataTypeGain(event: EventInterface,
                                     dataType: string,
                                     startDate?: Date,
                                     endDate?: Date,
                                     activities?: ActivityInterface[],
                                     precision?: number,
                                     minDiff?: number): number {
    precision = precision || 1;
    minDiff = minDiff || 1.5;
    let gain = 0;
    event.getPoints(startDate, endDate, activities).reduce((previous: PointInterface, next: PointInterface) => {
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
    return gain;
  }

  public static getEventDataTypeLoss(event: EventInterface,
                                     dataType: string,
                                     startDate?: Date,
                                     endDate?: Date,
                                     activities?: ActivityInterface[],
                                     precision?: number,
                                     minDiff?: number): number {
    precision = precision || 1;
    minDiff = minDiff || 1.5;
    let loss = 0;
    event.getPoints(startDate, endDate, activities).reduce((previous: PointInterface, next: PointInterface) => {
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
    return loss;
  }


  public static mergeEvents(events: EventInterface[]): Promise<EventInterface> {
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
      mergeEvent.name = 'Merged at ' + (new Date()).toISOString();
      return resolve(mergeEvent);
    });
  }

  public static generateSummaries(event: EventInterface) {
    // Todo should also work for event
    event.getActivities().map((activity: ActivityInterface) => {
      this.generateSummaryForActivityOrLap(event, activity);
      activity.getLaps().map((lap: LapInterface) => {
        this.generateSummaryForActivityOrLap(event, lap);
      })
    })
  }

  private static generateSummaryForActivityOrLap(event: EventInterface, subject: ActivityInterface | LapInterface) {
    // Altitude
    subject.summary.maxAltitudeInMeters = this.getDateTypeMaximum(event, DataAltitude.type, subject.startDate, subject.endDate);
    subject.summary.minAltitudeInMeters = this.getDateTypeMinimum(event, DataAltitude.type, subject.startDate, subject.endDate);
    // Heart Rate
    subject.summary.maxHR = this.getDateTypeMaximum(event, DataHeartRate.type, subject.startDate, subject.endDate);
    subject.summary.minHR = this.getDateTypeMinimum(event, DataHeartRate.type, subject.startDate, subject.endDate);
    subject.summary.avgHR = this.getDataTypeAverage(event, DataHeartRate.type, subject.startDate, subject.endDate);
    // Cadence
    subject.summary.maxCadence = this.getDateTypeMaximum(event, DataCadence.type, subject.startDate, subject.endDate);
    subject.summary.minCadence = this.getDateTypeMinimum(event, DataCadence.type, subject.startDate, subject.endDate);
    subject.summary.avgCadence = this.getDataTypeAverage(event, DataCadence.type, subject.startDate, subject.endDate);
    // Speed
    subject.summary.maxSpeed = this.getDateTypeMaximum(event, DataSpeed.type, subject.startDate, subject.endDate);
    subject.summary.minSpeed = this.getDateTypeMinimum(event, DataSpeed.type, subject.startDate, subject.endDate);
    subject.summary.avgSpeed = this.getDataTypeAverage(event, DataSpeed.type, subject.startDate, subject.endDate);
    // Vertical Speed
    subject.summary.maxVerticalSpeed = this.getDateTypeMaximum(event, DataVerticalSpeed.type, subject.startDate, subject.endDate);
    subject.summary.minVerticalSpeed = this.getDateTypeMinimum(event, DataVerticalSpeed.type, subject.startDate, subject.endDate);
    subject.summary.avgVerticalSpeed = this.getDataTypeAverage(event, DataVerticalSpeed.type, subject.startDate, subject.endDate);
    // Power
    subject.summary.maxPower = this.getDateTypeMaximum(event, DataVerticalSpeed.type, subject.startDate, subject.endDate);
    subject.summary.minPower = this.getDateTypeMinimum(event, DataVerticalSpeed.type, subject.startDate, subject.endDate);
    subject.summary.avgPower = this.getDataTypeAverage(event, DataVerticalSpeed.type, subject.startDate, subject.endDate);
    // Temperature
    subject.summary.maxTemperature = this.getDateTypeMaximum(event, DataTemperature.type, subject.startDate, subject.endDate);
    subject.summary.minTemperature = this.getDateTypeMinimum(event, DataTemperature.type, subject.startDate, subject.endDate);
    subject.summary.avgTemperature = this.getDataTypeAverage(event, DataTemperature.type, subject.startDate, subject.endDate);
  }
}


// public createEventFromJSONSMLString(data: string): Promise<EventInterface> {
//   return new Promise((resolve, reject) => {
//     return resolve(EventImporterSML.getFromJSONString(data));
//   });
// }


// public createEventFromJSONFITString(data: string): Promise<EventInterface> {
//   return new Promise((resolve, reject) => {
//     return resolve(EventImporterFIT.getFromJSONString(data));
//   });
// }



