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
import {DataEHPE} from "../../../data/data.ehpe";
import {DataEVPE} from "../../../data/data.evpe";
import {DataNumberOfSatellites} from "../../../data/data.number-of-satellites";
import {DataSatellite5BestSNR} from "../../../data/data.satellite-5-best-snr";
import {Summary} from "../../../summary/summary";

export class EventImporterSuuntoJSON {
  static getFromJSONString(jsonString: string, id?: string): EventInterface {
    const eventJSONObject = JSON.parse(jsonString);
    debugger;
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
      if (sample.EHPE) {
        point.addData(new DataEHPE(sample.EHPE));
      }
      if (sample.EVPE) {
        point.addData(new DataEVPE(sample.EVPE));
      }
      if (sample.NumberOfSatellites) {
        point.addData(new DataNumberOfSatellites(sample.NumberOfSatellites));
      }
      if (sample.Satellite5BestSNR) {
        point.addData(new DataSatellite5BestSNR(sample.Satellite5BestSNR));
      }
    }

    // Parse the laps
    for (const lapWindow of eventJSONObject.DeviceLog.Windows) {
      const lapObj = lapWindow.Window;
      if (lapObj.Type !== 'Autolap') {
        continue;
      }
      const lap = new Lap(
        new Date((new Date(lapObj.TimeISO8601)).getTime() - (lapObj.Duration * 1000)),
        new Date(lapObj.TimeISO8601)
      );
      const lapSummary = new Summary();
      lap.setTriggerMethod(lapObj.Type);
      lap.setCalories(lapObj.Energy);
      lapSummary.setTotalDistanceInMeters(lapObj.Distance);
      lapSummary.setTotalDurationInSeconds(lapObj.Duration);
      event.addLap(lap);
    }

    return event;
  }
}
