import {Event} from '../../event';
import {Activity} from '../../../activities/activity';
import {Creator} from '../../../creators/creator';
import {Lap} from '../../../laps/lap';
import {Point} from '../../../points/point';
import {DataAltitude} from '../../../data/data.altitude';
import {DataCadence} from '../../../data/data.cadence';
import {DataHeartRate} from '../../../data/data.heart-rate';
import {DataSpeed} from '../../../data/data.speed';
import {EventInterface} from '../../event.interface';
import {DataLatitudeDegrees} from '../../../data/data.latitude-degrees';
import {DataLongitudeDegrees} from '../../../data/data.longitude-degrees';
import {DataPower} from '../../../data/data.power';

export class EventImporterTCX {

  static getFromXML(xml: Document, id?: string): EventInterface {

    // Create an event
    const event = new Event();
    event.setID(id || event.getID());

    // Iterate over activities
    for (const activityElement of <any>xml.getElementsByTagName('TrainingCenterDatabase')[0].getElementsByTagName('Activity')) {
      const activity = new Activity(event);
      activity.setType(activityElement.getAttribute('Sport'));

      // Setup the creators
      for (const creatorElement of <any>activityElement.getElementsByTagName('Creator')) {
        const creator = new Creator(activity);
        creator.setName(creatorElement.getElementsByTagName('Name')[0].textContent);
      }

      // Setup the laps
      for (const lapElement of <any>activityElement.getElementsByTagName('Lap')) {
        // If the lap does not have any elapsed time or distance dont add it
        if (Math.round(Number(lapElement.getElementsByTagName('TotalTimeSeconds')[0].textContent)) === 0) {
          continue;
        }
        const lap = new Lap(event);
        lap.setStartDate(new Date(lapElement.getAttribute('StartTime')));
        lap.setEndDate(
          new Date(lap.getStartDate().getTime() + 1000 * Number(lapElement.getElementsByTagName('TotalTimeSeconds')[0].textContent))
        );
        if (lapElement.getElementsByTagName('Calories')[0]) {
          lap.setCalories(Number(lapElement.getElementsByTagName('Calories')[0].textContent));
        }
        if (lapElement.getElementsByTagName('Intensity')[0]) {
          lap.setIntensity(lapElement.getElementsByTagName('Intensity')[0].textContent);
        }
        if (lapElement.getElementsByTagName('TriggerMethod')[0]) {
          lap.setTriggerMethod(lapElement.getElementsByTagName('TriggerMethod')[0].textContent);
        }

        // Go over the points and append them to the track
        for (const pointElement of <any>lapElement.getElementsByTagName('Trackpoint')) {
          const point = new Point(new Date(pointElement.getElementsByTagName('Time')[0].textContent));
          point.setActivity(activity);
          for (const dataElement of <any>pointElement.children) {
            switch (dataElement.tagName) {
              case 'Position': {
                new DataLatitudeDegrees(point, dataElement.getElementsByTagName('LatitudeDegrees')[0].textContent);
                new DataLongitudeDegrees(point, dataElement.getElementsByTagName('LongitudeDegrees')[0].textContent);
                break;
              }
              case 'AltitudeMeters': {
                new DataAltitude(point, dataElement.textContent);
                break;
              }
              case 'Cadence': {
                new DataCadence(point, dataElement.textContent);
                break;
              }
              case 'HeartRateBpm': {
                new DataHeartRate(point, dataElement.getElementsByTagName('Value')[0].textContent);
                break;
              }
              case 'Extensions': {
                for (const dataExtensionElement of <any>dataElement.getElementsByTagName('TPX')[0].children) {
                  switch (dataExtensionElement.tagName) {
                    case 'Speed': {
                      new DataSpeed(point, dataExtensionElement.textContent);
                      break;
                    }
                    case 'RunCadence': {
                      new DataCadence(point, dataExtensionElement.textContent);
                      break;
                    }
                    case 'Watts': {
                      new DataPower(point, dataExtensionElement.textContent);
                      break;
                    }
                  }
                }
                break;
              }
            }
          }
        }
      }
    }
    return event;
  }
}
