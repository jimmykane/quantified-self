import {Event} from '../../../event';
import {Activity} from '../../../../activities/activity';
import {Creator} from '../../../../creators/creator';
import {Lap} from '../../../../laps/lap';
import {Point} from '../../../../points/point';
import {DataAltitude} from '../../../../data/data.altitude';
import {DataCadence} from '../../../../data/data.cadence';
import {DataHeartRate} from '../../../../data/data.heart-rate';
import {DataSpeed} from '../../../../data/data.speed';
import {DataVerticalSpeed} from '../../../../data/data.verticalspeed';
import {DataTemperature} from '../../../../data/data.temperature';
import {DataSeaLevelPressure} from '../../../../data/data.sea-level-pressure';
import {EventInterface} from '../../../event.interface';
import {DataLatitudeDegrees} from '../../../../data/data.latitude-degrees';
import {DataLongitudeDegrees} from '../../../../data/data.longitude-degrees';
import {DataPower} from '../../../../data/data.power';
import {DataGPSAltitude} from '../../../../data/data.altitude-gps';
import {DataAbsolutePressure} from '../../../../data/data.absolute-pressure';
import {DataEHPE} from '../../../../data/data.ehpe';
import {DataEVPE} from '../../../../data/data.evpe';
import {DataNumberOfSatellites} from '../../../../data/data.number-of-satellites';
import {DataSatellite5BestSNR} from '../../../../data/data.satellite-5-best-snr';
import {Summary} from '../../../../summary/summary';
import {IntensityZones} from '../../../../intensity-zones/intensity-zone';
import {IBIData} from '../../../../data/ibi/data.ibi';
import {PointInterface} from '../../../../points/point.interface';
import {SummaryInterface} from '../../../../summary/summary.interface';
import {EventUtilities} from '../../../utilities/event.utilities';
import {ImporterSuuntoActivityIds} from './import.suunto.activity.ids';

export class EventImporterSuuntoJSON {

  static getFromJSONString(jsonString: string): EventInterface {
    const eventJSONObject = JSON.parse(jsonString);
    debugger;

    // Populate the event summary from the Header Object
    const event = new Event();
    event.summary = this.getSummary(eventJSONObject.DeviceLog.Header);

    // Create a creator and pass it to all activities (later)
    const creator = new Creator();
    creator.name = this.getDeviceModelFromCodeName(eventJSONObject.DeviceLog.Device.Name);
    creator.serialNumber = eventJSONObject.DeviceLog.Device.SerialNumber;
    creator.hwInfo = eventJSONObject.DeviceLog.Device.Info.HW;
    creator.swInfo = eventJSONObject.DeviceLog.Device.Info.SW;

    // Find the activity windows and generate their summaries from there
    eventJSONObject.DeviceLog.Windows.filter((windowObj) => {
      return windowObj.Window.Type === 'Activity';
    }).forEach((activityObj) => {
      activityObj = activityObj.Window;

      // Set the activity props
      const activity = new Activity();
      activity.creator = creator;
      activity.summary = this.getSummary(activityObj);
      activity.endDate = new Date(activityObj.TimeISO8601);

      // Find the start date
      for (const sample of eventJSONObject.DeviceLog.Samples){
        if (sample.Events && sample.Events[0].Activity && sample.Events[0].Activity.ActivityType === activityObj.ActivityId) {
          activity.startDate = new Date(sample.TimeISO8601);
          break;
        }
      }

      // Now that we know the start date we can set the pause time on the summary
      activity.summary.pauseDurationInSeconds = (
        (activity.endDate.getTime() - activity.startDate.getTime() - activity.summary.totalDurationInSeconds * 1000)
        / 1000);
      // Increase the total duration since it missed the pause time
      activity.summary.totalDurationInSeconds += activity.summary.pauseDurationInSeconds;
      // Set the type
      activity.type = ImporterSuuntoActivityIds[activityObj.ActivityId];

      debugger;

      // Add the points for this activity from samples
      this.getPointsFromSamples(eventJSONObject.DeviceLog.Samples).filter((point) => {
        return point.getDate() >= activity.startDate && point.getDate() <= activity.endDate;
      }).forEach((point) => {
        activity.addPoint(point);
      });

      // Go over the laps of this activity
      eventJSONObject.DeviceLog.Windows.filter((windowObj) => {
        return (['Lap', 'Autolap'].indexOf(windowObj.Window.Type) !== -1) && activityObj.ActivityId === windowObj.Window.ActivityId;
      }).forEach((lapObj) => {
        lapObj = lapObj.Window;
        const lap = new Lap(
          new Date((new Date(lapObj.TimeISO8601)).getTime() - (lapObj.Duration * 1000)),
          new Date(lapObj.TimeISO8601)
        );
        lap.type = lapObj.Type;
        lap.summary = this.getSummary(lapObj);
        activity.addLap(lap);
      });

      if (eventJSONObject.DeviceLog['R-R'] && eventJSONObject.DeviceLog['R-R'].Data) {
        this.setIBIData(activity, eventJSONObject);
      }

      event.addActivity(activity);
    });

    return event;
  }

  private static setIBIData(activity: Activity, eventJSONObject: any) {
    activity.ibiData = new IBIData(eventJSONObject.DeviceLog['R-R'].Data);
    // @todo optimize
    // Create a second IBIData so we can have filtering on those with keeping the original
    (new IBIData(eventJSONObject.DeviceLog['R-R'].Data))
      .lowLimitBPMFilter()
      .highLimitBPMFilter()
      .lowPassFilter()
      .movingMedianFilter()
      .getAsBPM().forEach((value, key, map) => {
      const point = new Point(new Date(activity.startDate.getTime() + key));
      point.addData(new DataHeartRate(value));

      // If it belongs to the activity add it
      if (point.getDate() >= activity.startDate && point.getDate() <= activity.endDate) {
        activity.addPoint(point);
      }
    });
  }

  private static getPointsFromSamples(samples: any[]): PointInterface[] {
    return samples.reduce((pointsArray, sample) => {
      // Skip unwanted samples
      if (sample.Debug || sample.Events) {
        debugger;
        return pointsArray;
      }
      const point = new Point(new Date(sample.TimeISO8601));
      if (sample.hasOwnProperty('HR') && sample.HR !== null) {
        point.addData(new DataHeartRate(sample.HR * 60))
      }
      if (sample.hasOwnProperty('GPSAltitude') && sample.GPSAltitude !== null) {
        point.addData(new DataGPSAltitude(sample.GPSAltitude))
      }
      if (sample.hasOwnProperty('Latitude') && sample.Latitude !== null) {
        point.addData(new DataLatitudeDegrees(sample.Latitude * (180 / Math.PI)))
      }
      if (sample.hasOwnProperty('Longitude') && sample.Longitude !== null) {
        point.addData(new DataLongitudeDegrees(sample.Longitude * (180 / Math.PI)))
      }
      if (sample.hasOwnProperty('AbsPressure') && sample.AbsPressure !== null) {
        point.addData(new DataAbsolutePressure(sample.AbsPressure / 1000))
      }
      if (sample.hasOwnProperty('SeaLevelPressure') && sample.SeaLevelPressure !== null) {
        point.addData(new DataSeaLevelPressure(sample.SeaLevelPressure / 1000))
      }
      if (sample.hasOwnProperty('Altitude') && sample.Altitude !== null) {
        point.addData(new DataAltitude(sample.Altitude))
      }
      if (sample.hasOwnProperty('Cadence') && sample.Cadence !== null) {
        point.addData(new DataCadence(sample.Cadence * 120))
      }
      if (sample.hasOwnProperty('Power') && sample.Power !== null) {
        point.addData(new DataPower(sample.Power))
      }
      if (sample.hasOwnProperty('Speed') && sample.Speed !== null) {
        point.addData(new DataSpeed(sample.Speed))
      }
      if (sample.hasOwnProperty('Temperature') && sample.Temperature !== null) {
        point.addData(new DataTemperature(sample.Temperature - 273.15))
      }
      if (sample.hasOwnProperty('VerticalSpeed') && sample.VerticalSpeed !== null) {
        point.addData(new DataVerticalSpeed(sample.VerticalSpeed))
      }
      if (sample.hasOwnProperty('EHPE') && sample.EHPE !== null) {
        point.addData(new DataEHPE(sample.EHPE));
      }
      if (sample.hasOwnProperty('EVPE') && sample.EVPE !== null) {
        point.addData(new DataEVPE(sample.EVPE));
      }
      if (sample.hasOwnProperty('NumberOfSatellites') && sample.NumberOfSatellites !== null) {
        point.addData(new DataNumberOfSatellites(sample.NumberOfSatellites));
      }
      if (sample.hasOwnProperty('Satellite5BestSNR') && sample.Satellite5BestSNR !== null) {
        point.addData(new DataSatellite5BestSNR(sample.Satellite5BestSNR));
      }
      pointsArray.push(point);
      return pointsArray;
    }, []);
  }

  private static getSummary(object: any): SummaryInterface {

    const summary = new Summary();
    summary.totalDistanceInMeters = object.Distance;
    summary.totalDurationInSeconds = object.Duration;
    summary.maxAltitudeInMeters = object.Altitude.Max;
    summary.minAltitudeInMeters = object.Altitude.Min;
    summary.ascentTimeInSeconds = object.AscentTime;
    summary.descentTimeInSeconds = object.DescentTime;
    summary.ascentInMeters = object.Ascent;
    summary.descentInMeters = object.Descent;
    summary.epoc = object.EPOC;
    summary.energyInCal = object.Energy * 0.239 / 1000;
    summary.feeling = object.Feeling;
    summary.peakTrainingEffect = object.PeakTrainingEffect;
    summary.recoveryTimeInSeconds = object.RecoveryTime;
    summary.maxVO2 = object.MAXVO2;

    if (object.PauseDuration) {
      summary.pauseDurationInSeconds = object.PauseDuration;
      summary.totalDurationInSeconds += object.PauseDuration;
    }


    if (object.HR) {
      summary.avgHR = object.HR[0].Avg * 60;
      summary.maxHR = object.HR[0].Max * 60;
      summary.minHR = object.HR[0].Min * 60;
    }

    if (object.Cadence) {
      summary.avgCadence = object.Cadence[0].Avg * 60 * 2;
      summary.maxCadence = object.Cadence[0].Max * 60 * 2;
      summary.minCadence = object.Cadence[0].Min * 60 * 2;
    }

    if (object.Power) {
      summary.avgPower = object.Power[0].Avg;
      summary.maxPower = object.Power[0].Max;
      summary.minPower = object.Power[0].Min;
    }

    if (object.Speed) {
      summary.avgSpeed = object.Speed[0].Avg;
      summary.maxSpeed = object.Speed[0].Max;
      summary.minSpeed = object.Speed[0].Min;
    }

    if (object.Temperature) {
      summary.avgTemperature = object.Temperature[0].Avg - 273.15;
      summary.maxTemperature = object.Temperature[0].Max - 273.15;
      summary.minTemperature = object.Temperature[0].Min - 273.15;
    }

    if (object.VerticalSpeed) {
      summary.avgVerticalSpeed = object.VerticalSpeed[0].Avg;
      summary.maxVerticalSpeed = object.VerticalSpeed[0].Max;
      summary.minVerticalSpeed = object.VerticalSpeed[0].Min;
    }

    if (object.HrZones) {
      summary.intensityZones.set(DataHeartRate.type, this.getZones(object.HrZones));
    }

    if (object.PowerZones) {
      summary.intensityZones.set(DataPower.type, this.getZones(object.PowerZones));
    }

    if (object.SpeedZones) {
      summary.intensityZones.set(DataSpeed.type, this.getZones(object.SpeedZones));
    }
    return summary;
  }

  private static getZones(zonesObj: any): IntensityZones {
    const zones = new IntensityZones;
    zones.zone1Duration = zonesObj.Zone1Duration;
    zones.zone2Duration = zonesObj.Zone2Duration;
    zones.zone2LowerLimit = zonesObj.Zone2LowerLimit;
    zones.zone3Duration = zonesObj.Zone3Duration;
    zones.zone3LowerLimit = zonesObj.Zone3LowerLimit;
    zones.zone4Duration = zonesObj.Zone4Duration;
    zones.zone4LowerLimit = zonesObj.Zone4LowerLimit;
    zones.zone5Duration = zonesObj.Zone5Duration;
    zones.zone5LowerLimit = zonesObj.Zone5LowerLimit;
    return zones;
  }

  private static getDeviceModelFromCodeName(codeName: string): string {
    switch (codeName) {
      case 'Amsterdam': {
        return 'Spartan Ultra';
      }
      case 'Brighton': {
        return 'Spartan Sport'
      }
      case 'Cairo': {
        return 'Spartan WHR'
      }
      case 'Forssa': {
        return 'Spartan Trainer'
      }
      case 'Gdansk': {
        return 'Spartan WHR Baro'
      }
      case 'Helsinki': {
        return '3 Fitness'
      }
    }
    return codeName;
  }
}
