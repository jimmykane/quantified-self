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
import {DataEnergy} from '../../../../data/data.energy';
import {ActivityInterface} from '../../../../activities/activity.interface';
import {LapInterface} from '../../../../laps/lap.interface';
import {DataDistance} from '../../../../data/data.distance';
import {PointInterface} from '../../../../points/point.interface';
import {DataVerticalSpeed} from '../../../../data/data.vertical-speed';
import {ImporterFitGarminDeviceNames} from './importer.fit.garmin.device.names';
import {ImporterFitSuuntoDeviceNames} from './importer.fit.suunto.device.names';
import {DataPause} from '../../../../data/data.pause';
import {DataInterface} from '../../../../data/data.interface';
import {isNumberOrString} from '../../../utilities/event.utilities';
import {DataCadenceAvg} from '../../../../data/data.cadence-avg';
import {DataPowerAvg} from '../../../../data/data.power-avg';
import {DataSpeedAvg} from '../../../../data/data.speed-avg';
import {DataCadenceMax} from '../../../../data/data.cadence-max';
import {DataPowerMax} from '../../../../data/data.power-max';
import {DataAscent} from '../../../../data/data.ascent';
import {DataDescent} from '../../../../data/data.descent';
import {DataHeartRateAvg} from '../../../../data/data.heart-rate-avg';

export class EventImporterFIT {

  static getFromArrayBuffer(arrayBuffer: ArrayBuffer): Promise<EventInterface> {
    return new Promise((resolve, reject) => {

      const easyFitParser = new EasyFit({
        force: false,
        speedUnit: 'm/s',
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
          // Set the activity stats
          this.getStatsFromObject(sessionObject).forEach(stat => activity.addStat(stat));
          // Set the creator to the activity
          activity.creator = this.getCreatorFromFitDataObject(fitDataObject);
          // Go over the laps
          sessionObject.laps.forEach((sessionLapObject) => {
            // Get and add the lap to the activity
            const lap = this.getLapFromSessionLapObject(sessionLapObject);
            // Add stats to the lap
            this.getStatsFromObject(sessionLapObject).forEach(stat => lap.addStat(stat));
            // Go over the records and add the points to the activity
            sessionLapObject.records.forEach((sessionLapObjectRecord) => {
              const point = this.getPointFromSessionLapObjectRecord(sessionLapObjectRecord);
              activity.addPoint(point);
            });
            // Add the lap to the activity
            activity.addLap(lap);
          });
          event.addActivity(activity);
        });
        // Set the totals for the event
        event.setDuration(new DataDuration(event.getActivities().reduce((duration, activity) => activity.getDuration().getValue(), 0)));
        event.setDistance(new DataDistance(event.getActivities().reduce((duration, activity) => activity.getDistance().getValue(), 0)));
        event.setPause(new DataPause(event.getActivities().reduce((duration, activity) => activity.getPause().getValue(), 0)));
        resolve(event);
      });

    });
  }

  private static getPointFromSessionLapObjectRecord(sessionLapObjectRecord): PointInterface {
    const point = new Point(sessionLapObjectRecord.timestamp);
    // Add Lat
    if (isNumberOrString(sessionLapObjectRecord.position_lat)) {
      point.addData(new DataLatitudeDegrees(sessionLapObjectRecord.position_lat));
    }
    // Add long
    if (isNumberOrString(sessionLapObjectRecord.position_long)) {
      point.addData(new DataLongitudeDegrees(sessionLapObjectRecord.position_long));
    }
    // Add HR
    if (isNumberOrString(sessionLapObjectRecord.heart_rate)) {
      point.addData(new DataHeartRate(sessionLapObjectRecord.heart_rate));
    }
    // Add Altitude
    if (isNumberOrString(sessionLapObjectRecord.altitude)) {
      point.addData(new DataAltitude(sessionLapObjectRecord.altitude));
    }
    // Add Cadence
    if (isNumberOrString(sessionLapObjectRecord.cadence)) {
      let cadenceValue = sessionLapObjectRecord.cadence;
      // Add the fractional cadence if it's there
      if (isNumberOrString(sessionLapObjectRecord.fractional_cadence)) {
        cadenceValue += sessionLapObjectRecord.fractional_cadence;
      }
      point.addData(new DataCadence(cadenceValue));
    }
    // Add Speed
    if (isNumberOrString(sessionLapObjectRecord.speed)) {
      point.addData(new DataSpeed(sessionLapObjectRecord.speed));
    }
    // Add Vertical Speed
    if (isNumberOrString(sessionLapObjectRecord.vertical_speed)) {
      point.addData(new DataVerticalSpeed(sessionLapObjectRecord.vertical_speed));
    }
    // Add Temperature
    if (isNumberOrString(sessionLapObjectRecord.temperature)) {
      point.addData(new DataTemperature(sessionLapObjectRecord.temperature));
    }
    return point;
  }

  private static getLapFromSessionLapObject(sessionLapObject): LapInterface {
    const lap = new Lap(sessionLapObject.start_time, sessionLapObject.timestamp);

    // Set the duration
    lap.setDuration(new DataDuration(sessionLapObject.total_timer_time));

    // Set the pause which is elapsed time - moving time
    lap.setPause(new DataPause(sessionLapObject.total_elapsed_time - sessionLapObject.total_timer_time));

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
    activity.setDuration(new DataDuration(sessionObject.total_timer_time));

    // Set the pause which is elapsed time - moving time
    activity.setPause(new DataPause(sessionObject.total_elapsed_time - sessionObject.total_timer_time));

    // Set the distance
    activity.setDistance(new DataDistance(sessionObject.total_distance));

    // Set the calories
    activity.addStat(new DataEnergy(sessionObject.total_calories));

    // Set the type
    activity.type = this.getActivityTypeFromSessionObject(sessionObject);

    return activity;
  }

  private static getActivityTypeFromSessionObject(session: any): string {
    if (session.sub_sport !== 'generic') {
      return ActivityTypes[session.sub_sport] || ActivityTypes[session.sport] || 'unknown'
    }
    return ActivityTypes[session.sport]
  }

  private static getStatsFromObject(object): DataInterface[] {
    const stats = [];
    if (isNumberOrString(object.avg_heart_rate)) {
      stats.push(new DataHeartRateAvg(object.avg_heart_rate));
    }
    if (isNumberOrString(object.max_heart_rate)) {
      stats.push(new DataHeartRateAvg(object.max_heart_rate));
    }
    if (isNumberOrString(object.avg_cadence)) {
      stats.push(new DataCadenceAvg(object.avg_cadence));
    }
    if (isNumberOrString(object.max_cadence)) {
      stats.push(new DataCadenceMax(object.max_cadence));
    }
    if (isNumberOrString(object.avg_power)) {
      stats.push(new DataPowerAvg(object.avg_power));
    }
    if (isNumberOrString(object.max_power)) {
      stats.push(new DataPowerMax(object.max_power));
    }
    if (isNumberOrString(object.avg_speed)) {
      stats.push(new DataSpeedAvg(object.avg_speed));
    }
    if (isNumberOrString(object.avg_speed)) {
      stats.push(new DataSpeedAvg(object.avg_speed));
    }
    if (isNumberOrString(object.total_ascent)) {
      stats.push(new DataAscent(object.total_ascent));
    }
    if (isNumberOrString(object.total_descent)) {
      stats.push(new DataDescent(object.total_descent));
    }
    if (isNumberOrString(object.total_calories)) {
      stats.push(new DataEnergy(object.total_calories));
    }
    return stats;
  }

  private static getCreatorFromFitDataObject(fitDataObject: any): CreatorInterface {
    const creator = new Creator();
    if (isNumberOrString(fitDataObject.file_creator.hardware_version)) {
      creator.hwInfo = String(fitDataObject.file_creator.hardware_version);
    }
    if (isNumberOrString(fitDataObject.file_creator.software_version)) {
      creator.swInfo = String(fitDataObject.file_creator.software_version);
    }
    if (isNumberOrString(fitDataObject.file_id.serial_number)) {
      creator.serialNumber = fitDataObject.file_id.serial_number;
    }

    // Set the name
    if (fitDataObject.file_id.manufacturer === 'suunto') {
      creator.name = ImporterFitSuuntoDeviceNames[fitDataObject.file_id.product];
    } else if (fitDataObject.file_id.manufacturer === 'garmin') {
      creator.name = ImporterFitGarminDeviceNames[fitDataObject.file_id.product];
    } else {
      creator.name = 'Unknown device';
    }
    return creator;
  }
}
