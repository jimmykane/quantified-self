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
import EasyFit from 'easy-fit';

export class EventImporterFIT {

  static getFromJSONString(jsonString: string, id?: string): Promise<EventInterface> {
    return new Promise((resolve, reject) => {

      const easyFitParser = new EasyFit({
        force: false,
        speedUnit: 'km/h',
        lengthUnit: 'm',
        temperatureUnit: 'celsius',
        elapsedRecordField: false,
        mode: 'cascade',
      });

      easyFitParser.parse(jsonString, (error, data: any) => {
        const event = new Event();
        for (const session of data.activity.sessions) {
          const activity = new Activity(event);
          activity.setType(session.sport);
          for (const sessionLap of session.laps) {
            const lap = new Lap(activity);
            lap.setStartDate(sessionLap.start_time);
            lap.setEndDate(sessionLap.timestamp);
            for (const lapRecord of sessionLap.records) {
              const point = new Point(new Date(lapRecord.timestamp));
              point.setActivity(activity);
              Object.keys(lapRecord).forEach((key) => {
                switch (key) {
                  case 'altitude': { return new DataAltitude(point, lapRecord[key]); }
                  case 'position_lat': { return new DataLatitudeDegrees(point, lapRecord[key]); }
                  case 'position_long': { return new DataLongitudeDegrees(point, lapRecord[key]); }
                  case 'cadence': { return new DataCadence(point, lapRecord[key]); }
                  case 'heart_rate': { return new DataHeartRate(point, lapRecord[key]); }
                  case 'vertical_speed': { return new DataVerticalSpeed(point, lapRecord[key]); }
                  case 'speed': { return new DataSpeed(point, lapRecord[key]); }
                  case 'temperature': { return new DataTemperature(point, lapRecord[key]); }
                }
              });
            }
          }
        }
        resolve(event);
      });

    });
  }
}
