import {EventImporterSuuntoJSON} from '../adapters/importers/importer.suunto.json';
import {EventInterface} from '../event.interface';
import {EventImporterJSON} from '../adapters/importers/importer.json';
import {Summary} from '../../summary/summary';
import {ActivityInterface} from '../../activities/activity.interface';
import {GeoLibAdapter} from '../../geodesy/adapters/geolib.adapter';
import {EventExporterTCX} from '../adapters/exporters/exporter.tcx';
import {PointInterface} from "../../points/point.interface";
import {Event} from "../event";

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

  public static generateEventSummaries(event: EventInterface): Promise<EventInterface> {
    return new Promise(((resolve, reject) => {

      for (const activity of event.getActivities()) {
        const activitySummary = new Summary();
        activitySummary.totalDistanceInMeters = this.getEventDistanceInMeters(
          event, void 0, void 0, [activity]
        );

        activitySummary.totalDurationInSeconds = (+activity.endDate - +activity.startDate) / 1000;
        activity.summary = activitySummary;

        // If indoors
        if (!event.hasPointsWithPosition(void 0, void 0, [activity])) {
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

  public static getEventDataTypeAverage(event: EventInterface,
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



