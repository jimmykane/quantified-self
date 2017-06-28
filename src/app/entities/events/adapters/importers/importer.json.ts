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
import {DataRespirationRate} from "../../../data/data.respiration-rate";
import {DataEHPE} from "../../../data/data.ehpe";
import {DataAbsolutePressure} from "../../../data/data.absolute-pressure";
import {DataGPSAltitude} from "../../../data/data.gps-altitude";

export class EventImporterJSON {

  static getFromJSONString(jsonString: string, id?: string): EventInterface {
    const eventObject = JSON.parse(jsonString);
    const event = new Event();
    event.setID(eventObject.id);
    event.setName(eventObject.name);

    for (const lapObject of eventObject.laps) {
      const lap = new Lap(event);
      lap.setStartDate(new Date(lapObject.startDate));
      lap.setEndDate(new Date(lapObject.endDate));
      lap.setCalories(lapObject.calories);
      lap.setIntensity(lapObject.intensity);
      lap.setTriggerMethod(lapObject.triggerMethod);
    }

    for (const activityObject of eventObject.activities) {
      const activity = new Activity(event);
      activity.setType(activityObject.type);
      for (const creatorObject of activityObject.creators) {
        const creator = new Creator(activity);
        creator.setName(creatorObject.name);
      }

      for (const pointObject of activityObject.points) {
        const point = new Point(new Date(pointObject.date));
        point.setActivity(activity);
        for (const dataObject of pointObject.data) {
          // @todo make this dynamic
          switch (dataObject.type) {
            case 'DataAltitude': {
              new DataAltitude(point, dataObject.value);
              break;
            }
            case 'DataGPSAltitude': {
              new DataGPSAltitude(point, dataObject.value);
              break;
            }
            case 'DataRespirationRate': {
              new DataRespirationRate(point, dataObject.value);
              break;
            }
            case 'DataEHPE': {
              new DataEHPE(point, dataObject.value);
              break;
            }
            case 'DataAbsolutePressure': {
              new DataAbsolutePressure(point, dataObject.value);
              break;
            }
            case 'DataCadence': {
              new DataCadence(point, dataObject.value);
              break;
            }
            case 'DataHeartRate': {
              new DataHeartRate(point, dataObject.value);
              break;
            }
            case 'DataLatitudeDegrees': {
              new DataLatitudeDegrees(point, dataObject.value);
              break;
            }
            case 'DataLongitudeDegrees': {
              new DataLongitudeDegrees(point, dataObject.value);
              break;
            }
            case 'DataSeaLevelPressure': {
              new DataSeaLevelPressure(point, dataObject.value);
              break;
            }
            case 'DataSpeed': {
              new DataSpeed(point, dataObject.value);
              break;
            }
            case 'DataTemperature': {
              new DataTemperature(point, dataObject.value);
              break;
            }
            case 'DataVerticalSpeed': {
              new DataVerticalSpeed(point, dataObject.value);
              break;
            }
            case 'DataPower': {
              new DataPower(point, dataObject.value);
              break;
            }
          }
        }
      }
    }
    return event;
  }
}
