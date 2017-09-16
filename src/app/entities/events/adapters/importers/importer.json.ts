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
import {DataPower} from '../../../data/data.power';
import {DataRespirationRate} from '../../../data/data.respiration-rate';
import {DataEHPE} from '../../../data/data.ehpe';
import {DataAbsolutePressure} from '../../../data/data.absolute-pressure';
import {DataGPSAltitude} from '../../../data/data.gps-altitude';

export class EventImporterJSON {

  static getFromJSONString(jsonString: string, id?: string): EventInterface {
    const eventObject = JSON.parse(jsonString);
    const event = new Event();
    event.setID(eventObject.id);
    event.setName(eventObject.name);

    for (const lapObject of eventObject.laps) {
      const lap = new Lap(new Date(lapObject.startDate), new Date(lapObject.endDate));
      lap.setCalories(lapObject.calories);
      lap.setIntensity(lapObject.intensity);
      lap.setTriggerMethod(lapObject.triggerMethod);
      event.addLap(lap);
    }

    for (const activityObject of eventObject.activities) {
      const activity = new Activity();
      activity.setType(activityObject.type);
      event.addActivity(activity);
      for (const creatorObject of activityObject.creators) {
        const creator = new Creator(activity);
        creator.setName(creatorObject.name);
      }

      for (const pointObject of activityObject.points) {
        const point = new Point(new Date(pointObject.date));
        activity.addPoint(point);
        for (const dataObject of pointObject.data) {
          // @todo make this dynamic
          switch (dataObject.type) {
            case 'Altitude': {
              point.addData(new DataAltitude(dataObject.value));
              break;
            }
            case 'Altitude GPS': {
              point.addData(new DataGPSAltitude(dataObject.value));
              break;
            }
            case 'Respiration Rate': {
              point.addData(new DataRespirationRate(dataObject.value));
              break;
            }
            case 'EHPE': {
              point.addData(new DataEHPE(dataObject.value));
              break;
            }
            case 'Absolute Pressure': {
              point.addData(new DataAbsolutePressure(dataObject.value));
              break;
            }
            case 'Cadence': {
              point.addData(new DataCadence(dataObject.value));
              break;
            }
            case 'Heart Rate': {
              point.addData(new DataHeartRate(dataObject.value));
              break;
            }
            case 'Latitude': {
              point.addData(new DataLatitudeDegrees(dataObject.value));
              break;
            }
            case 'Longitude': {
              point.addData(new DataLongitudeDegrees(dataObject.value));
              break;
            }
            case 'Sea Level Pressure': {
              point.addData(new DataSeaLevelPressure(dataObject.value));
              break;
            }
            case 'Speed': {
              point.addData(new DataSpeed(dataObject.value));
              break;
            }
            case 'Temperature': {
              point.addData(new DataTemperature(dataObject.value));
              break;
            }
            case 'Vertical Speed': {
              point.addData(new DataVerticalSpeed(dataObject.value));
              break;
            }
            case 'Power': {
              point.addData(new DataPower(dataObject.value));
              break;
            }
          }
        }
      }
    }
    return event;
  }
}
