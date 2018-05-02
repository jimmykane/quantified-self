import {EventInterface} from '../event.interface';
import {ActivityInterface} from '../../activities/activity.interface';
import {EventExporterTCX} from '../adapters/exporters/exporter.tcx';
import {PointInterface} from '../../points/point.interface';
import {Event} from '../event';
import {LapInterface} from '../../laps/lap.interface';
import {DataHeartRate} from '../../data/data.heart-rate';
import {DataCadence} from '../../data/data.cadence';
import {DataSpeed} from '../../data/data.speed';
import {DataVerticalSpeed} from '../../data/data.vertical-speed';
import {DataTemperature} from '../../data/data.temperature';
import {DataAltitude} from '../../data/data.altitude';
import {DataPower} from '../../data/data.power';
import {DataAltitudeMax} from '../../data/data.altitude-max';
import {DataAltitudeMin} from '../../data/data.altitude-min';
import {DataAltitudeAvg} from '../../data/data.altitude-avg';
import {DataHeartRateMax} from '../../data/data.heart-rate-max';
import {DataHeartRateMin} from '../../data/data.heart-rate-min';
import {DataHeartRateAvg} from '../../data/data.heart-rate-avg';
import {DataCadenceMax} from '../../data/data.cadence-max';
import {DataCadenceMin} from '../../data/data.cadence-min';
import {DataCadenceAvg} from '../../data/data.cadence-avg';
import {DataSpeedMax} from '../../data/data.speed-max';
import {DataSpeedMin} from '../../data/data.speed-min';
import {DataSpeedAvg} from '../../data/data.speed-avg';
import {DataVerticalSpeedMax} from '../../data/data.vertical-speed-max';
import {DataVerticalSpeedMin} from '../../data/data.vertical-speed-min';
import {DataVerticalSpeedAvg} from '../../data/data.vertical-speed-avg';
import {DataPowerMax} from '../../data/data.power-max';
import {DataPowerMin} from '../../data/data.power-min';
import {DataPowerAvg} from '../../data/data.power-avg';
import {DataTemperatureMax} from '../../data/data.temperature-max';
import {DataTemperatureMin} from '../../data/data.temperature-min';
import {DataTemperatureAvg} from '../../data/data.temperature-avg';
import {DataDistance} from '../../data/data.distance';
import {DataDuration} from '../../data/data.duration';
import {DataPause} from '../../data/data.pause';

export class EventUtilities {

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
      const value = Number(point.getDataByType(dataType).getValue());
      if (isNaN(value) || !isFinite(value)) {
        return;
      }
      average += value;
      count++;
      return average;
    }, 0);
    return count ? (averageForDataType / count) : null;
  }

  public static getDateTypeMaximum(event: EventInterface,
                                   dataType: string,
                                   startDate?: Date,
                                   endDate?: Date,
                                   activities?: ActivityInterface[]): number {

    return this.getDataTypeMinOrMax(true, event, dataType, startDate, endDate, activities);
  }

  public static getDateTypeMinimum(event: EventInterface,
                                   dataType: string,
                                   startDate?: Date,
                                   endDate?: Date,
                                   activities?: ActivityInterface[]): number {
    return this.getDataTypeMinOrMax(false, event, dataType, startDate, endDate, activities);

  }

  public static mergeEvents(events: EventInterface[]): Promise<EventInterface> {
    return new Promise((resolve, reject) => {
      // First sort the events by first point date
      events.sort((eventA: EventInterface, eventB: EventInterface) => {
        return +eventA.getFirstActivity().startDate - +eventB.getFirstActivity().startDate;
      });
      const mergeEvent = new Event();
      mergeEvent.setDistance(new DataDistance(0));
      mergeEvent.setDuration(new DataDuration(0));
      mergeEvent.setPause(new DataPause(0));
      for (const event of events) {
        for (const activity of event.getActivities()) {
          mergeEvent.addActivity(activity);
          mergeEvent.getDistance().setValue(mergeEvent.getDistance().getValue() + activity.getDistance().getValue());
          mergeEvent.getDuration().setValue(mergeEvent.getDuration().getValue() + activity.getDuration().getValue());
          mergeEvent.getPause().setValue(mergeEvent.getPause().getValue() + activity.getPause().getValue());
          // @todo merge the rest of the stats
        }
      }

      mergeEvent.name = 'Merged at ' + (new Date()).toISOString();
      return resolve(mergeEvent);
    });
  }

  public static generateStats(event: EventInterface) {
    // Todo should also work for event
    event.getActivities().map((activity: ActivityInterface) => {
      this.generateStatsForActivityOrLap(event, activity);
      activity.getLaps().map((lap: LapInterface) => {
        this.generateStatsForActivityOrLap(event, lap);
      })
    })
  }

  public static getEventDataTypeGain(event: EventInterface,
                                     dataType: string,
                                     activities?: ActivityInterface[],
                                     minDiff?: number): number {
    return this.getEventDataTypeGainOrLoss(true, event, dataType, activities, minDiff);
  }


  public static getEventDataTypeLoss(event: EventInterface,
                                     dataType: string,
                                     activities?: ActivityInterface[],
                                     minDiff?: number): number {
    return this.getEventDataTypeGainOrLoss(false, event, dataType, activities, minDiff);
  }

  private static getEventDataTypeGainOrLoss(gain: boolean,
                                            event: EventInterface,
                                            dataType: string,
                                            activities?: ActivityInterface[],
                                            minDiff?: number): number {
    // @todo safeguard on number data types
    minDiff = minDiff || 1;
    let gainOrLoss = 0;
    event.getPoints(void 0, void 0, activities).reduce((previous: PointInterface, next: PointInterface) => {
      if (!previous.getDataByType(dataType)) {
        return next;
      }
      if (!next.getDataByType(dataType)) {
        return previous;
      }
      // Gain!
      if (gain) {
        // Increase the gain if eligible first check to be greater plus diff  [200, 300, 400, 100, 101, 102]
        if ((<number>previous.getDataByType(dataType).getValue() + minDiff) <= <number>next.getDataByType(dataType).getValue()) {
          gainOrLoss += <number>next.getDataByType(dataType).getValue() - <number>previous.getDataByType(dataType).getValue();
          return next;
        }
        // if not eligible check if smaller without the diff and if yes do not register it and send it back as the last to check against
        if (<number>previous.getDataByType(dataType).getValue() <= <number>next.getDataByType(dataType).getValue()) {
          return previous;
        }
        return next
      }
      // Loss
      // Increase the loss if eligible
      if ((<number>previous.getDataByType(dataType).getValue() - minDiff) >= <number>next.getDataByType(dataType).getValue() {
        gainOrLoss += <number>previous.getDataByType(dataType).getValue() - <number>next.getDataByType(dataType).getValue();
        return next;
      }
      // if not eligible check if smaller without the diff and if yes do not register it and send it back as the last to check against
      if (<number>previous.getDataByType(dataType).getValue() >= <number>next.getDataByType(dataType).getValue()) {
        return previous;
      }
      return next;
    });
    return gainOrLoss;
  }

  private static getDataTypeMinOrMax(max: boolean,
                                     event: EventInterface,
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
    if (max) {
      return dataValuesArray.length ? Math.max(...dataValuesArray) : null;
    }
    return dataValuesArray.length ? Math.min(...dataValuesArray) : null;
  }

  private static generateStatsForActivityOrLap(event: EventInterface, subject: ActivityInterface | LapInterface) {
    // Altitude
    if (subject.getStat(DataAltitudeMax.className) === undefined && this.getDateTypeMaximum(event, DataAltitude.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataAltitudeMax(this.getDateTypeMaximum(event, DataAltitude.type, subject.startDate, subject.endDate)));
    }
    if (subject.getStat(DataAltitudeMin.className) === undefined && this.getDateTypeMinimum(event, DataAltitude.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataAltitudeMin(this.getDateTypeMinimum(event, DataAltitude.type, subject.startDate, subject.endDate)));
    }
    if (subject.getStat(DataAltitudeAvg.className) === undefined && this.getDataTypeAverage(event, DataAltitude.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataAltitudeAvg(this.getDataTypeAverage(event, DataAltitude.type, subject.startDate, subject.endDate)));
    }
    // Heart Rate
    if (subject.getStat(DataHeartRateMax.className) === undefined && this.getDateTypeMaximum(event, DataHeartRate.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataHeartRateMax(this.getDateTypeMaximum(event, DataHeartRate.type, subject.startDate, subject.endDate)));
    }
    if (subject.getStat(DataHeartRateMin.className) === undefined && this.getDateTypeMinimum(event, DataHeartRate.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataHeartRateMin(this.getDateTypeMinimum(event, DataHeartRate.type, subject.startDate, subject.endDate)));
    }
    if (subject.getStat(DataHeartRateAvg.className) === undefined && this.getDataTypeAverage(event, DataHeartRate.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataHeartRateAvg(this.getDataTypeAverage(event, DataHeartRate.type, subject.startDate, subject.endDate)));
    }

    if (subject.getStat(DataCadenceMax.className) === undefined && this.getDateTypeMaximum(event, DataCadence.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataCadenceMax(this.getDateTypeMaximum(event, DataCadence.type, subject.startDate, subject.endDate)));
    }
    if (subject.getStat(DataCadenceMin.className) === undefined && this.getDateTypeMinimum(event, DataCadence.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataCadenceMin(this.getDateTypeMinimum(event, DataCadence.type, subject.startDate, subject.endDate)));
    }
    if (subject.getStat(DataCadenceAvg.className) === undefined && this.getDataTypeAverage(event, DataCadence.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataCadenceAvg(this.getDataTypeAverage(event, DataCadence.type, subject.startDate, subject.endDate)));
    }

    // Speed
    if (subject.getStat(DataSpeedMax.className) === undefined && this.getDateTypeMaximum(event, DataSpeed.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataSpeedMax(this.getDateTypeMaximum(event, DataSpeed.type, subject.startDate, subject.endDate)));
    }
    if (subject.getStat(DataSpeedMin.className) === undefined && this.getDateTypeMinimum(event, DataSpeed.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataSpeedMin(this.getDateTypeMinimum(event, DataSpeed.type, subject.startDate, subject.endDate)));
    }
    if (subject.getStat(DataSpeedAvg.className) === undefined && this.getDataTypeAverage(event, DataSpeed.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataSpeedAvg(this.getDataTypeAverage(event, DataSpeed.type, subject.startDate, subject.endDate)));
    }

    // Vertical Speed
    if (subject.getStat(DataVerticalSpeedMax.className) === undefined && this.getDateTypeMaximum(event, DataVerticalSpeed.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataVerticalSpeedMax(this.getDateTypeMaximum(event, DataVerticalSpeed.type, subject.startDate, subject.endDate)));
    }
    if (subject.getStat(DataVerticalSpeedMin.className) === undefined && this.getDateTypeMinimum(event, DataVerticalSpeed.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataVerticalSpeedMin(this.getDateTypeMinimum(event, DataVerticalSpeed.type, subject.startDate, subject.endDate)));
    }
    if (subject.getStat(DataVerticalSpeedAvg.className) === undefined && this.getDataTypeAverage(event, DataVerticalSpeed.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataVerticalSpeedAvg(this.getDataTypeAverage(event, DataVerticalSpeed.type, subject.startDate, subject.endDate)));
    }

    // Power
    if (subject.getStat(DataPowerMax.className) === undefined && this.getDateTypeMaximum(event, DataPower.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataPowerMax(this.getDateTypeMaximum(event, DataPower.type, subject.startDate, subject.endDate)));
    }
    if (subject.getStat(DataPowerMin.className) === undefined && this.getDateTypeMinimum(event, DataPower.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataPowerMin(this.getDateTypeMinimum(event, DataPower.type, subject.startDate, subject.endDate)));
    }
    if (subject.getStat(DataPowerAvg.className) === undefined && this.getDataTypeAverage(event, DataPower.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataPowerAvg(this.getDataTypeAverage(event, DataPower.type, subject.startDate, subject.endDate)));
    }

    // Temperature
    if (subject.getStat(DataTemperatureMax.className) === undefined && this.getDateTypeMaximum(event, DataTemperature.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataTemperatureMax(this.getDateTypeMaximum(event, DataTemperature.type, subject.startDate, subject.endDate)));
    }
    if (subject.getStat(DataTemperatureMin.className) === undefined && this.getDateTypeMinimum(event, DataTemperature.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataTemperatureMin(this.getDateTypeMinimum(event, DataTemperature.type, subject.startDate, subject.endDate)));
    }
    if (subject.getStat(DataTemperatureAvg.className) === undefined && this.getDataTypeAverage(event, DataTemperature.type, subject.startDate, subject.endDate) !== null) {
      subject.addStat(new DataTemperatureAvg(this.getDataTypeAverage(event, DataTemperature.type, subject.startDate, subject.endDate)));
    }
  }

  // private static geodesyAdapter = new GeoLibAdapter();
  //
  // public static getEventDistanceInMeters(event: EventInterface,
  //                                        startDate?: Date,
  //                                        endDate?: Date,
  //                                        activities?: ActivityInterface[]): number {
  //   if (!event.hasPointsWithPosition()) {
  //     return 0;
  //   }
  //   return event.getActivities().reduce((distance: number, activity: ActivityInterface) => {
  //     return distance + this.geodesyAdapter.getDistance(event.getPointsWithPosition(void 0, void 0, [activity]));
  //   }, 0);
  // }
}

export function isNumberOrString(property: any) {
  return (typeof property === 'number' || typeof property === 'string');
}

