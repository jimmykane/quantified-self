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
        debugger;
        const event = new Event();
        let recordCount = 0;
        let dataCount = 0;
        for (const session of data.activity.sessions) {
          const activity = new Activity(event);
          activity.setType(session.sport);

          const creator = new Creator(activity);
          creator.setName(data.file_id.manufacturer);

          for (const sessionLap of session.laps) {
            // If the lap does not have any elapsed time or distance dont add it
            if (Math.round(Number(sessionLap.timestamp)) === 0){
              continue;
            }
            const lap = new Lap(event);
            lap.setStartDate(sessionLap.start_time);
            lap.setEndDate(sessionLap.timestamp);
            for (const lapRecord of sessionLap.records) {
              recordCount++;
              const point = new Point(new Date(lapRecord.timestamp));
              point.setActivity(activity);
               // Hack for strange Suunto data
              if (creator.getName() === 'suunto') {
                if (lapRecord.position_lat && lapRecord.position_long) {
                  new DataLatitudeDegrees(point, lapRecord.position_lat);
                  new DataLongitudeDegrees(point, lapRecord.position_long);
                  dataCount++;
                  dataCount++;
                  continue;
                }
              }
              Object.keys(lapRecord).forEach((key) => {
                dataCount++;
                switch (key) {
                  case 'altitude': { return new DataAltitude(point, Number(lapRecord[key]) - 1000); }
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
        console.log('Imported ' + recordCount + ' records with ' + dataCount + ' of data');
        resolve(event);
      });

    });
  }
}
