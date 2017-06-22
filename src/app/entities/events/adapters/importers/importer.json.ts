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

export class EventImporterJSON {

  static getFromJSONString(jsonString: string, id?: string): EventInterface {
    const eventObject = JSON.parse(jsonString);
    const event = new Event();
    event.setID(eventObject.id);
    event.setName(eventObject.name);
    for (const activityObject of eventObject.activities){
      const activity = new Activity(event);
      activity.setType(activityObject.type);
      for (const creatorObject of activityObject.creators){
        const creator = new Creator(activity);
        creator.setName(creatorObject.name);
      }
      for (const lapObject of activityObject.laps) {
        const lap = new Lap(activity);
        lap.setStartDate(new Date(lapObject.startDate));
        lap.setEndDate(new Date(lapObject.endDate));
        lap.setCalories(lapObject.calories);
        lap.setIntensity(lapObject.intensity);
        lap.setTriggerMethod(lapObject.triggerMethod);
      }
      for (const pointObject of activityObject.points){
        const point = new Point(activity, new Date(pointObject.date));
        for (const dataObject of pointObject.data){
          switch (dataObject.type) {
            case 'DataAltitude': {
              new DataAltitude(point, dataObject.value);
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
