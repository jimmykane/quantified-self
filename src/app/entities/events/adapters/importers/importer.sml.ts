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

export class EventImporterSML {

  static getFromJSONString(jsonString: string, id?: string): EventInterface {

    const event = new Event();


    const laps = this.getLapsArray(jsonString);
    throw ('Not Implemented');
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
