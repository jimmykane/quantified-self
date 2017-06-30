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
      event.addLap(eventLap);
    }

    JSON.parse(jsonString)['Samples'].forEach((jsonSampleEntry) => {
      const date = new Date(jsonSampleEntry['TimeISO8601']);
      const suuntoSML = JSON.parse(jsonSampleEntry['Attributes'])['suunto/sml'];

      if (suuntoSML['R-R'] && suuntoSML['R-R']['Data']) {
        const point = new Point(date);
        activity.addPoint(point);
        new DataRespirationRate(point, suuntoSML['R-R']['Data'].split(',').reduce((acc, data, i, array) => {
          return acc + Number(data.trim()) / array.length
        }));
        return;
      }

      if (suuntoSML['Sample'] && !suuntoSML['Sample']['Events']) {
        const point = new Point(date);
        activity.addPoint(point); // @todo dont add if not any data
        Object.keys(suuntoSML['Sample']).forEach((key) => {
          if (suuntoSML['Sample'][key] === null) {
            return;
          }
          switch (key) {
            case 'EHPE': {
              new DataEHPE(point, Number(suuntoSML['Sample'][key]));
              break;
            }
            case 'Latitude': {
              new DataLatitudeDegrees(point, Number(suuntoSML['Sample'][key]) * (180 / Math.PI));
              break;
            }
            case 'Longitude': {
              new DataLongitudeDegrees(point, Number(suuntoSML['Sample'][key]) * (180 / Math.PI));
              break;
            }
            case 'AbsPressure': {
              new DataAbsolutePressure(point, Number(suuntoSML['Sample'][key]) / 1000);
              break;
            }
            case 'Altitude': {
              new DataAltitude(point, suuntoSML['Sample'][key]);
              break;

            }
            case 'GPSAltitude': {
              new DataGPSAltitude(point, suuntoSML['Sample'][key]);
              break;

            }
            case 'Cadence': {
              new DataCadence(point, suuntoSML['Sample'][key] * 50);
              break;

            }
            case 'HR': {
              new DataHeartRate(point, suuntoSML['Sample'][key] * 50);
              break;

            }
            case 'Power': {
              new DataPower(point, suuntoSML['Sample'][key]);
              break;

            }
            case 'SeaLevelPressure': {
              new DataSeaLevelPressure(point, Number(suuntoSML['Sample'][key]) / 1000);
              break;

            }
            case 'Speed': {
              new DataSpeed(point, suuntoSML['Sample'][key]);
              break;

            }
            case 'Temperature': {
              new DataTemperature(point, suuntoSML['Sample'][key] - 273.15); // convert to celsius from kelvin
              break;

            }
            case 'VerticalSpeed': {
              new DataVerticalSpeed(point, suuntoSML['Sample'][key]);
              break;
            }
          }
        });
      }
    });
    debugger;
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
