/*
import {Event} from '../../event';
import {Activity} from '../../../activities/activity';
import {Lap} from '../../../laps/lap';
import {Point} from '../../../points/point';
import {DataAltitude} from '../../../data/data.altitude';
import {DataCadence} from '../../../data/data.cadence';
import {DataHeartRate} from '../../../data/data.heart-rate';
import {DataSpeed} from '../../../data/data.speed';
import {EventInterface} from '../../event.interface';
import {DataLatitudeDegrees} from '../../../data/data.latitude-degrees';
import {DataLongitudeDegrees} from '../../../data/data.longitude-degrees';
import {DataSeaLevelPressure} from '../../../data/data.sea-level-pressure';
import {DataTemperature} from '../../../data/data.temperature';
import {DataVerticalSpeed} from '../../../data/data.verticalspeed';
import {Creator} from '../../../creators/creator';
import {DataRespirationRate} from '../../../data/data.respiration-rate';
import {PointInterface} from '../../../points/point.interface';
import {DataAbsolutePressure} from '../../../data/data.absolute-pressure';
import {DataPower} from '../../../data/data.power';
import {DataEHPE} from '../../../data/data.ehpe';
import {DataGPSAltitude} from '../../../data/data.gps-altitude';

export class EventImporterSML {

  static getFromJSONString(jsonString: string, id?: string): EventInterface {

    const event = new Event();
    const activity = new Activity();
    event.addActivity(activity);


    const laps = this.getLapsArray(jsonString);
    for (const lap of laps) {
      const eventLap = new Lap(lap.startDate, lap.endDate);
      activity.addLap(eventLap);
    }

    JSON.parse(jsonString)['Samples'].forEach((jsonSampleEntry) => {
      const date = new Date(jsonSampleEntry['TimeISO8601']);
      const suuntoSML = JSON.parse(jsonSampleEntry['Attributes'])['suunto/sml'];

      if (suuntoSML['R-R'] && suuntoSML['R-R']['Data']) {
        const point = new Point(date);
        activity.addPoint(point);
        point.addData(new DataRespirationRate(suuntoSML['R-R']['Data'].split(',').reduce((acc, data, i, array) => {
          return acc + Number(data.trim()) / array.length
        }, 0)));
        return;
      }

      if (suuntoSML['Sample'] && !suuntoSML['Sample']['Events']) {
        const point = new Point(date);
        Object.keys(suuntoSML['Sample']).forEach((key) => {
          if (suuntoSML['Sample'][key] === null) {
            return;
          }
          switch (key) {
            case DataEHPE.type: {
              point.addData(new DataEHPE(Number(suuntoSML['Sample'][key])));
              break;
            }
            case DataLatitudeDegrees.type: {
              point.addData(new DataLatitudeDegrees(Number(suuntoSML['Sample'][key]) * (180 / Math.PI)));
              break;
            }
            case DataLongitudeDegrees.type: {
              point.addData(new DataLongitudeDegrees(Number(suuntoSML['Sample'][key]) * (180 / Math.PI)));
              break;
            }
            case DataAbsolutePressure.type: {
              point.addData(new DataAbsolutePressure(Number(suuntoSML['Sample'][key]) / 1000));
              break;
            }
            case DataAltitude.type: {
              point.addData(new DataAltitude(suuntoSML['Sample'][key]));
              break;

            }
            case DataGPSAltitude.type: {
              point.addData(new DataGPSAltitude(suuntoSML['Sample'][key]));
              break;

            }
            case DataCadence.type: {
              point.addData(new DataCadence(suuntoSML['Sample'][key] * 50));
              break;

            }
            case DataHeartRate.type: {
              point.addData(new DataHeartRate(suuntoSML['Sample'][key] * 50));
              break;

            }
            case DataPower.type: {
              point.addData(new DataPower(suuntoSML['Sample'][key]));
              break;

            }
            case DataSeaLevelPressure.type: {
              point.addData(new DataSeaLevelPressure(Number(suuntoSML['Sample'][key]) / 1000));
              break;

            }
            case DataSpeed.type: {
              point.addData(new DataSpeed(suuntoSML['Sample'][key]));
              break;

            }
            case DataTemperature.type: {
              point.addData(new DataTemperature(suuntoSML['Sample'][key] - 273.15)); // convert to celsius from kelvin
              break;

            }
            case DataVerticalSpeed.type: {
              point.addData(new DataVerticalSpeed(suuntoSML['Sample'][key]));
              break;
            }
          }
        });

        if (Array.from(point.getData().keys()).length) {
          activity.addPoint(point);
        }

      }
    });
    return event;
  }

  private static getLapsArray(jsonString): any[] {
    const laps = [];
    JSON.parse(jsonString)['Samples'].reduce((lap, jsonSampleEntry) => {
      const date = new Date(jsonSampleEntry['TimeISO8601']);
      const suuntoSML = JSON.parse(jsonSampleEntry['Attributes'])['suunto/sml'];
      if (!suuntoSML['Sample'] || !suuntoSML['Sample']['Events']) {
        return lap;
      }
      suuntoSML['Sample']['Events'].forEach((event: any) => {
        if (!event['Lap']) {
          return;
        }

        if (event['Lap']['Type'] === 'Start') {
          lap.startDate = date
        }
        if (event['Lap']['Type'] === 'Stop') {
          lap.endDate = date;
        }

        if (lap.startDate && lap.endDate) {
          laps.push(lap);
        }
      });
      return lap
    }, {});
    return laps;
  }
}
*/
