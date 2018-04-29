import {Event} from '../../../event';
import {Activity} from '../../../../activities/activity';
import {Lap} from '../../../../laps/lap';
import {Point} from '../../../../points/point';
import {DataAltitude} from '../../../../data/data.altitude';
import {DataCadence} from '../../../../data/data.cadence';
import {DataHeartRate} from '../../../../data/data.heart-rate';
import {DataSpeed} from '../../../../data/data.speed';
import {EventInterface} from '../../../event.interface';
import {DataLatitudeDegrees} from '../../../../data/data.latitude-degrees';
import {DataLongitudeDegrees} from '../../../../data/data.longitude-degrees';
import {DataTemperature} from '../../../../data/data.temperature';
import {Creator} from '../../../../creators/creator';
import EasyFit from 'easy-fit';
import {CreatorInterface} from '../../../../creators/creatorInterface';
import {ActivityTypes} from '../../../../activities/activity.types';
import {DataDuration} from '../../../../data/data.duration';
import {DataEnergy} from "../../../../data/data.energy";
import {ActivityInterface} from "../../../../activities/activity.interface";
import {LapInterface} from "../../../../laps/lap.interface";
import {DataDistance} from "../../../../data/data.distance";

export class EventImporterFIT {

  static getFromArrayBuffer(arrayBuffer: ArrayBuffer): Promise<EventInterface> {
    return new Promise((resolve, reject) => {

      const easyFitParser = new EasyFit({
        force: false,
        speedUnit: 'km/h',
        lengthUnit: 'm',
        temperatureUnit: 'celsius',
        elapsedRecordField: false,
        mode: 'cascade',
      });

      easyFitParser.parse(arrayBuffer, (error, fitDataObject: any) => {
        debugger;
        // Create an event
        const event = new Event();
        // Iterate over the sessions and create their activities
        fitDataObject.activity.sessions.forEach((sessionObject) => {
          // Get the activity from the sessionObject
          const activity = this.getActivityFromSessionObject(sessionObject);

          // Go over the laps
          sessionObject.laps.forEach((sessionLapObject) => {
            const lap = this.getLapFromSessionLapObject(sessionLapObject);
            activity.addLap(lap);
          });

          debugger;
        });

        resolve(event);
      });

    });
  }

  private static getLapFromSessionLapObject(sessionLapObject): LapInterface {
    const lap = new Lap(sessionLapObject.start_time, sessionLapObject.timestamp);

    // Set the duration
    lap.setDuration(new DataDuration(sessionLapObject.total_moving_time));

    // Set the pause which is elapsed time - moving time
    lap.setPause(new DataDuration(sessionLapObject.total_elapsed_time - sessionLapObject.total_moving_time));

    // Set the distance
    lap.setDistance(new DataDistance(sessionLapObject.total_distance));

    // Set the calories
    if (sessionLapObject.total_calories) {
      lap.addStat(new DataEnergy(sessionLapObject.total_calories));
    }

    lap.type = sessionLapObject.lap_trigger === 'distance' ? 'Manual' : 'Manual';

    return lap;
  }

  private static getActivityFromSessionObject(sessionObject): ActivityInterface {
    // Create an activity
    const activity = new Activity();

    // Set the start date
    activity.startDate = sessionObject.start_time;

    // Set the end date
    activity.endDate = sessionObject.timestamp;

    // Set the duration which is the moving time
    activity.setDuration(new DataDuration(sessionObject.total_moving_time));

    // Set the pause which is elapsed time - moving time
    activity.setPause(new DataDuration(sessionObject.total_elapsed_time - sessionObject.total_moving_time));

    // Set the distance
    activity.setDistance(new DataDistance(sessionObject.total_distance));

    // Set the calories
    activity.addStat(new DataEnergy(sessionObject.total_calories));

    // Set the type
    activity.type = this.getActivityTypeFromSessionObject(sessionObject);

    return activity;
  }

  private static getActivityTypeFromSessionObject(session: any): string {
    if (session.sub_sport) {
      return ActivityTypes[session.sub_sport]
    }
    return ActivityTypes[session.sport]
  }

  private static getCreatorFromFitDataObject(fitDataObject: any): CreatorInterface {
    const creator = new Creator();
    creator.hwInfo = fitDataObject.file_creator.hardware_version;
    creator.swInfo = fitDataObject.file_creator.software_version;

    // Set the name
    if (fitDataObject.file_id.manufacturer !== 'suunto') {
      creator.name = fitDataObject.file_id.product;
      return creator;
    }

    // If it's a suunto fit
    switch (fitDataObject.file_id.product) {
      case 34: {
        creator.name = 'Suunto 9';
        break;
      }
      case 29: {
        creator.name = 'Suunto Spartan Ultra';
        break;
      }
    }
    return creator;
  }
}
