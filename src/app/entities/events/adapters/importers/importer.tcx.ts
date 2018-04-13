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
import {LapInterface} from '../../../laps/lap.interface';
import {EventUtilities} from '../../utilities/event.utilities';
import {DataEnergy} from '../../../data/data.energy';
import {DataDuration} from '../../../data/data.duration';
import {DataDistance} from '../../../data/data.distance';
import {DataPause} from '../../../data/data.pause';
import {DataSpeedMax} from '../../../data/data.speed-max';
import {DataHeartRateAvg} from '../../../data/data.heart-rate-avg';
import {DataHeartRateMax} from '../../../data/data.heart-rate-max';

export class EventImporterTCX {

  static getFromXML(xml: Document): EventInterface {

    const event = new Event();
    event.setDistance(new DataDistance(0));
    event.setDuration(new DataDuration(0));
    event.setPause(new DataPause(0));

    // Activities
    for (const activityElement of <any>xml.getElementsByTagName('TrainingCenterDatabase')[0].getElementsByTagName('Activity')) {
      const activity = new Activity();
      activity.type = activityElement.getAttribute('Sport');
      event.addActivity(activity);
      // First element must exist
      activity.startDate = new Date(activityElement.getElementsByTagName('Lap')[0].getAttribute('StartTime'));
      // Setup the creator
      activity.creator = this.getCreator(activityElement.getElementsByTagName('Creator')[0]);


      // Go over the laps and start filling up the stats and creating the points
      // @todo
      activity.setDuration(new DataDuration(0));
      activity.setDistance(new DataDistance(0));
      activity.setPause(new DataPause(0));
      activity.addStat(new DataEnergy(0));

      // Get the laps and add the total distance to the activity
      this.getLaps(activityElement.getElementsByTagName('Lap')).map((lap: LapInterface) => {
        activity.addLap(lap);
        // Increment wrapper stats
        activity.setDistance(new DataDistance(activity.getDistance().getValue() + lap.getDistance().getValue()));
        activity.setDuration(new DataDuration(activity.getDuration().getValue() + lap.getDuration().getValue() + lap.getPause().getValue()));
        activity.setPause(new DataPause(activity.getPause().getValue() + lap.getPause().getValue()));
        activity.addStat(new DataEnergy(activity.getStat(DataEnergy.className).getValue() + lap.getStat(DataEnergy.className).getValue()))

        // Todo perhaps think about distance if 0 to add the lap as pause

        // Same for event
        event.setDistance(new DataDistance(event.getDistance().getValue() + lap.getDistance().getValue()));
        event.setDuration(new DataDuration(event.getDuration().getValue() + lap.getDuration().getValue()));
        event.setPause(new DataPause(event.getPause().getValue() + lap.getPause().getValue()));
      });
      Array.from(activityElement.getElementsByTagName('Lap')).map((lapElement: HTMLElement) => {
        this.getPoints(<any>lapElement.getElementsByTagName('Trackpoint')).map((point) => {
          activity.addPoint(point);
        });
      });
    }

    EventUtilities.generateStats(event);
    return event;
  }

  private static getPoints(trackPointsElements: HTMLElement[]): PointInterface[] {
    return Array.from(trackPointsElements).reduce((pointsArray: PointInterface[], trackPointElement) => {
      const point = new Point(new Date(trackPointElement.getElementsByTagName('Time')[0].textContent));
      pointsArray.push(point);
      for (const dataElement of <any>trackPointElement.children) {
        switch (dataElement.tagName) {
          case 'Position': {
            point.addData(new DataLatitudeDegrees(Number(dataElement.getElementsByTagName('LatitudeDegrees')[0].textContent)));
            point.addData(new DataLongitudeDegrees(Number(dataElement.getElementsByTagName('LongitudeDegrees')[0].textContent)));
            break;
          }
          case 'AltitudeMeters': {
            point.addData(new DataAltitude(Number(dataElement.textContent)));
            break;
          }
          case 'Cadence': {
            point.addData(new DataCadence(Number(dataElement.textContent)));
            break;
          }
          case 'HeartRateBpm': {
            point.addData(new DataHeartRate(Number(dataElement.getElementsByTagName('Value')[0].textContent)));
            break;
          }
          case 'Extensions': {
            for (const dataExtensionElement of <any>dataElement.getElementsByTagNameNS('http://www.garmin.com/xmlschemas/ActivityExtension/v2', 'TPX')[0].children) {
              switch (dataExtensionElement.nodeName.replace(dataExtensionElement.prefix + ':', '')) {
                case 'Speed': {
                  point.addData(new DataSpeed(Number(dataExtensionElement.textContent)));
                  break;
                }
                case 'RunCadence': {
                  point.addData(new DataCadence(Number(dataExtensionElement.textContent) * 2));
                  break;
                }
                case 'Watts': {
                  point.addData(new DataPower(Number(dataExtensionElement.textContent)));
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
      creator.swInfo = creatorElement.getElementsByTagName('Version')[0].textContent;
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

      // Create a stats (required TCX fields)
      lap.addStat(new DataEnergy(Number(lapElement.getElementsByTagName('Calories')[0].textContent)));
      lap.addStat(new DataDuration(Number(lapElement.getElementsByTagName('TotalTimeSeconds')[0].textContent)));
      lap.addStat(new DataDistance(Number(lapElement.getElementsByTagName('DistanceMeters')[0].textContent)));
      lap.setPause(new DataPause(0));

      // Optionals
      if (lapElement.getElementsByTagName('MaximumSpeed')[0]) {
        lap.addStat(new DataSpeedMax(Number(lapElement.getElementsByTagName('MaximumSpeed')[0])));
      }

      if (lapElement.getElementsByTagName('AverageHeartRateBpm')[0]) {
        lap.addStat(new DataHeartRateAvg(Number(lapElement.getElementsByTagName('AverageHeartRateBpm')[0].getElementsByTagName('Value')[0].textContent)));
      }

      if (lapElement.getElementsByTagName('MaximumHeartRateBpm')[0]) {
        lap.addStat(new DataHeartRateMax(Number(lapElement.getElementsByTagName('MaximumHeartRateBpm')[0].getElementsByTagName('Value')[0].textContent)));
      }

      // Should check the track
      let lastPointFromPreviousTrack;
      // Get all the tracks and find the lap pause for this one
      Array.from(lapElement.getElementsByTagName('Track')).forEach((trackElement) => {
        // Get the last
        const firstPointFromCurrentTrack = trackElement.getElementsByTagName('Trackpoint')[0];
        // If there is no first point then no need to iterate it's empty
        if (!firstPointFromCurrentTrack) {
          return;
        }
        // if we do not have a last point of a previous parsed track set it to this one
        if (!lastPointFromPreviousTrack) {
          lastPointFromPreviousTrack = trackElement.getElementsByTagName('Trackpoint')[trackElement.getElementsByTagName('Trackpoint').length - 1];
          return;
        }
        // Here we should have the current first point and the last point from the previous track
        const lastPointTime = (new Date(lastPointFromPreviousTrack.getElementsByTagName('Time')[0].textContent)).getTime();
        const firstPointTime = (new Date(firstPointFromCurrentTrack.getElementsByTagName('Time')[0].textContent)).getTime();
        lap.setPause(new DataPause(lap.getPause().getValue() + (firstPointTime - lastPointTime) / 1000));
        // Set the last to this one (will become the previous track on next track)
        lastPointFromPreviousTrack = trackElement.getElementsByTagName('Trackpoint')[trackElement.getElementsByTagName('Trackpoint').length - 1];
      });


      lapArray.push(lap);
      return lapArray;
    }, []);
  }


}
