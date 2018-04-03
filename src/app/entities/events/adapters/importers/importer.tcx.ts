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
import {PointInterface} from '../../../points/point.interface';
import {CreatorInterface} from '../../../creators/creatorInterface';
import {Summary} from '../../../summary/summary';
import {LapInterface} from '../../../laps/lap.interface';
import {EventUtilities} from "../../utilities/event.utilities";
import {ActivityInterface} from "../../../activities/activity.interface";

export class EventImporterTCX {

  static getFromXML(xml: Document): EventInterface {

    const event = new Event();
    event.summary = new Summary();
    event.summary.totalDurationInSeconds = 0;
    event.summary.totalDistanceInMeters = 0;

    // Activities
    for (const activityElement of <any>xml.getElementsByTagName('TrainingCenterDatabase')[0].getElementsByTagName('Activity')) {
      const activity = new Activity();
      activity.type = activityElement.getAttribute('Sport');
      event.addActivity(activity);
      // First element must exist
      activity.startDate = new Date(activityElement.getElementsByTagName('Lap')[0].getAttribute('StartTime'));
      // Setup the creator
      activity.creator = this.getCreator(activityElement.getElementsByTagName('Creator')[0]);

      activity.summary = new Summary();

      // Go over the laps and start filling up the summary and creating the points
      // @todo
      activity.summary.totalDurationInSeconds = 0;
      activity.summary.totalDistanceInMeters = 0;

      // Get the laps and add the total distance to the activity
      this.getLaps(activityElement.getElementsByTagName('Lap')).map((lap: LapInterface) => {
        activity.addLap(lap);
        // Increment wrapper summaries
        activity.summary.totalDistanceInMeters += lap.summary.totalDistanceInMeters;
        activity.summary.totalDurationInSeconds += lap.summary.totalDurationInSeconds;
        event.summary.totalDistanceInMeters += lap.summary.totalDistanceInMeters;
        event.summary.totalDurationInSeconds += lap.summary.totalDurationInSeconds;
      });
      Array.from(activityElement.getElementsByTagName('Lap')).map((lapElement: HTMLElement) => {
        this.getPoints(<any>lapElement.getElementsByTagName('Trackpoint')).map((point) => {
          activity.addPoint(point);
        });
      });
    }
    EventUtilities.generateSummaries(event);
    return event;
  }

  private static getPoints(trackPointsElements: HTMLElement[]): PointInterface[] {
    return Array.from(trackPointsElements).reduce((pointsArray: PointInterface[], trackPointElement) => {
      const point = new Point(new Date(trackPointElement.getElementsByTagName('Time')[0].textContent));
      pointsArray.push(point);
      for (const dataElement of <any>trackPointElement.children) {
        switch (dataElement.tagName) {
          case 'Position': {
            point.addData(new DataLatitudeDegrees(dataElement.getElementsByTagName('LatitudeDegrees')[0].textContent));
            point.addData(new DataLongitudeDegrees(dataElement.getElementsByTagName('LongitudeDegrees')[0].textContent));
            break;
          }
          case 'AltitudeMeters': {
            point.addData(new DataAltitude(dataElement.textContent));
            break;
          }
          case 'Cadence': {
            point.addData(new DataCadence(dataElement.textContent));
            break;
          }
          case 'HeartRateBpm': {
            point.addData(new DataHeartRate(dataElement.getElementsByTagName('Value')[0].textContent));
            break;
          }
          case 'Extensions': {
            for (const dataExtensionElement of <any>dataElement.getElementsByTagName('TPX')[0].children) {
              switch (dataExtensionElement.tagName) {
                case 'Speed': {
                  point.addData(new DataSpeed(dataExtensionElement.textContent));
                  break;
                }
                case 'RunCadence': {
                  point.addData(new DataCadence(dataExtensionElement.textContent));
                  break;
                }
                case 'Watts': {
                  point.addData(new DataPower(dataExtensionElement.textContent));
                  break;
                }
              }
            }
            break;
          }
        }
      }
      return pointsArray;
    }, []);
  }

  private static getCreator(creatorElement?: HTMLElement): CreatorInterface {
    const creator = new Creator();
    if (!creatorElement) {
      creator.name = 'Unknown device';
      return creator;
    }
    creator.name = creatorElement.getElementsByTagName('Name')[0].textContent;
    if (creatorElement.getElementsByTagName('Version')[0]) {
      creator.setSWInfo(creatorElement.getElementsByTagName('Version')[0].textContent);
    }
    return creator;
  }

  private static getLaps(lapElements: HTMLElement[]): LapInterface[] {
    return Array.from(lapElements).reduce((lapArray, lapElement) => {
      // Create the lap
      const lap = new Lap(
        new Date(lapElement.getAttribute('StartTime')),
        new Date(
          +(new Date(lapElement.getAttribute('StartTime'))) +
          1000 * Number(lapElement.getElementsByTagName('TotalTimeSeconds')[0].textContent)
        ));
      lap.type = lapElement.getElementsByTagName('TriggerMethod')[0].textContent;

      // Create a summary (required TCX fields)
      lap.summary = new Summary();
      lap.summary.energyInCal = Number(lapElement.getElementsByTagName('Calories')[0].textContent);
      lap.summary.totalDurationInSeconds = Number(lapElement.getElementsByTagName('TotalTimeSeconds')[0].textContent);
      lap.summary.totalDistanceInMeters = Number(lapElement.getElementsByTagName('DistanceMeters')[0].textContent);

      // Optionals
      if (lapElement.getElementsByTagName('MaximumSpeed')[0]) {
        lap.summary.maxSpeed = Number(lapElement.getElementsByTagName('MaximumSpeed')[0]);
      }

      if (lapElement.getElementsByTagName('AverageHeartRateBpm')[0]) {
        lap.summary.avgHR = Number(
          lapElement.getElementsByTagName('AverageHeartRateBpm')[0].getElementsByTagName('Value')[0].textContent
        );
      }

      if (lapElement.getElementsByTagName('MaximumHeartRateBpm')[0]) {
        lap.summary.maxHR = Number(
          lapElement.getElementsByTagName('MaximumHeartRateBpm')[0].getElementsByTagName('Value')[0].textContent
        );
      }

      // Generate missing max,min,avg

      lapArray.push(lap);
      return lapArray;
    }, []);
  }


}
