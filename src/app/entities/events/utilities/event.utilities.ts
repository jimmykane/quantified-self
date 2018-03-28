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
    let count = 1;
    const averageForDataType = event.getPoints(startDate, endDate, activities).reduce((average: number, point: PointInterface) => {
      if (!point.getDataByType(dataType)) {
        return average;
      }
      average += point.getDataByType(dataType).getValue();
      count++;
      return average;
    }, 0);
    return averageForDataType / count;
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
    return Math.max(...dataValuesArray);
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
    return Math.min(...dataValuesArray);
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
      activity.getLaps().map((lap: LapInterface) => {
        lap.summary.maxHR = this.getDateTypeMaximum(event, DataHeartRate.type, lap.startDate, lap.endDate);
        lap.summary.minHR = this.getDateTypeMinimum(event, DataHeartRate.type, lap.startDate, lap.endDate);
        lap.summary.avgHR = this.getDataTypeAverage(event, DataHeartRate.type, lap.startDate, lap.endDate);
      })
    })
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



