import {Event} from '../../event';
import {Activity} from '../../../activities/activity';
import {Creator} from '../../../creators/creator';
import {Lap} from '../../../laps/lap';
import {Point} from '../../../points/point';
import {DataAltitude} from '../../../data/data.altitude';
import {DataCadence} from '../../../data/data.cadence';
import {DataHeartRate} from '../../../data/data.heart-rate';
import {DataSpeed} from '../../../data/data.speed';
import {DataVerticalSpeed} from '../../../data/data.verticalspeed';
import {DataTemperature} from '../../../data/data.temperature';
import {DataSeaLevelPressure} from '../../../data/data.sea-level-pressure';
import {EventInterface} from '../../event.interface';
import {DataLatitudeDegrees} from '../../../data/data.latitude-degrees';
import {DataLongitudeDegrees} from '../../../data/data.longitude-degrees';
import {DataPower} from "../../../data/data.power";
import {DataGPSAltitude} from "../../../data/data.gps-altitude";
import {DataAbsolutePressure} from "../../../data/data.absolute-pressure";

export class EventImporterSuuntoJSON {
  static getFromJSONString(jsonString: string, id?: string): EventInterface {
    const eventJSONObject = JSON.parse(jsonString);
    const event = new Event();

    const activity = new Activity();
    activity.setType(eventJSONObject.DeviceLog.Header.Activity);
    event.addActivity(activity);

    const creator = new Creator(activity);
    creator.setName(eventJSONObject.DeviceLog.Device.Name);
    activity.addCreator(creator);

    for (const sample of eventJSONObject.DeviceLog.Samples) {
      const point = new Point(new Date(sample.TimeISO8601));
      activity.addPoint(point);
      if (sample.HR) {
        point.addData(new DataHeartRate(sample.HR * 60))
      }
      if (sample.GPSAltitude) {
        point.addData(new DataGPSAltitude(sample.GPSAltitude))
      }
      if (sample.Latitude) {
        point.addData(new DataLatitudeDegrees(sample.Latitude * (180 / Math.PI)))
      }
      if (sample.Longitude) {
        point.addData(new DataLongitudeDegrees(sample.Longitude * (180 / Math.PI)))
      }
      if (sample.AbsPressure) {
        point.addData(new DataAbsolutePressure(sample.AbsPressure / 1000))
      }
      if (sample.SeaLevelPressure) {
        point.addData(new DataSeaLevelPressure(sample.SeaLevelPressure / 1000))
      }
      if (sample.Altitude) {
        point.addData(new DataAltitude(sample.Altitude))
      }
      if (sample.Cadence) {
        point.addData(new DataCadence(sample.Cadence * 120))
      }
      if (sample.Power) {
        point.addData(new DataPower(sample.Power))
      }
      if (sample.Speed) {
        point.addData(new DataSpeed(sample.Speed))
      }
      if (sample.Temperature) {
        point.addData(new DataTemperature(sample.Temperature - 273.15))
      }
      if (sample.VerticalSpeed) {
        point.addData(new DataVerticalSpeed(sample.VerticalSpeed))
      }
    }

    return event;
  }
}
