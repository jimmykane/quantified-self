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
import {DataTemperature} from '../../../data/data.temperature';
import {Creator} from '../../../creators/creator';
import EasyFit from 'easy-fit';

export class EventImporterFIT {

  static getFromArrayBuffer(jsonString: string, id?: string): Promise<EventInterface> {
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
          const activity = new Activity();
          activity.type = session.sport;
          event.addActivity(activity);

          const creator = new Creator();
          creator.name = data.file_id.manufacturer;
          activity.creator = creator;

          for (const sessionLap of session.laps) {
            // If the lap does not have any elapsed time or distance dont add it
            if (+sessionLap.start_time - +sessionLap.timestamp === 0) {
              continue;
            }
            const lap = new Lap(sessionLap.start_time, sessionLap.timestamp);
            activity.addLap(lap);
            for (const lapRecord of sessionLap.records) {
              recordCount++;
              const point = new Point(new Date(lapRecord.timestamp));
              activity.addPoint(point);
               // Hack for strange Suunto data
              if (creator.name  === 'suunto') {
                if (lapRecord.position_lat && lapRecord.position_long) {
                  point.addData(new DataLatitudeDegrees(lapRecord.position_lat));
                  point.addData(new DataLongitudeDegrees(lapRecord.position_long));
                  dataCount++;
                  dataCount++;
                  continue;
                }
              }
              Object.keys(lapRecord).forEach((key) => {
                dataCount++;
                switch (key) {
                  case 'altitude': { return point.addData(new DataAltitude(Number(lapRecord[key]))); }
                  case 'position_lat': { return point.addData(new DataLatitudeDegrees(lapRecord[key])); }
                  case 'position_long': { return point.addData(new DataLongitudeDegrees(lapRecord[key])); }
                  case 'cadence': { return point.addData(new DataCadence(lapRecord[key])); }
                  case 'heart_rate': { return point.addData(new DataHeartRate(lapRecord[key])); }
                  case 'speed': { return point.addData(new DataSpeed(lapRecord[key])); }
                  case 'temperature': { return point.addData(new DataTemperature(lapRecord[key])); }
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
