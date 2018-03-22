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
import {DataPower} from '../../../data/data.power';
import {DataGPSAltitude} from '../../../data/data.altitude-gps';
import {DataAbsolutePressure} from '../../../data/data.absolute-pressure';
import {DataEHPE} from '../../../data/data.ehpe';
import {DataEVPE} from '../../../data/data.evpe';
import {DataNumberOfSatellites} from '../../../data/data.number-of-satellites';
import {DataSatellite5BestSNR} from '../../../data/data.satellite-5-best-snr';
import {Summary} from '../../../summary/summary';
import {IntensityZones} from '../../../intensity-zones/intensity-zone';
import {IBIFilters} from '../../../data/ibi/data.ibi.filters';
import {IBIData} from '../../../data/ibi/data.ibi';
import {PointInterface} from "../../../points/point.interface";
import {SummaryInterface} from "../../../summary/summary.interface";

export class EventImporterSuuntoJSON {

  static getFromJSONString(jsonString: string, id?: string): EventInterface {

    const eventJSONObject = JSON.parse(jsonString);
    debugger;
    const event = new Event();

    // @todo iterate over activities
    const activity = new Activity();
    activity.startDate = new Date(eventJSONObject.DeviceLog.Header.DateTime);
    activity.type = this.getActivityTypeFromID(eventJSONObject.DeviceLog.Header.ActivityType);

    activity.summary = this.getSummary(eventJSONObject.DeviceLog.Header);
    event.addActivity(activity);

    const eventSummary = new Summary();
    eventSummary.totalDurationInSeconds = activity.summary.totalDurationInSeconds;
    eventSummary.totalDistanceInMeters = activity.summary.totalDistanceInMeters;

    event.summary = eventSummary;

    const creator = new Creator();
    creator.name = this.getDeviceModelFromCodeName(eventJSONObject.DeviceLog.Device.Name);
    creator.setSerialNumber(eventJSONObject.DeviceLog.Device.SerialNumber);
    creator.setHWInfo(eventJSONObject.DeviceLog.Device.Info.HW);
    creator.setSWInfo(eventJSONObject.DeviceLog.Device.Info.SW);
    activity.creator = creator;

    this.getPointsFromSamples(eventJSONObject.DeviceLog.Samples).map((point) => {
      activity.addPoint(point);
    });

    // Parse the laps
    let nextLapStartDate = event.getFirstActivity().startDate;
    for (const lapWindow of eventJSONObject.DeviceLog.Windows) {
      const lapObj = lapWindow.Window;
      if (lapObj.Type !== 'Autolap') {
        continue;
      }
      const lap = new Lap(
        nextLapStartDate,
        new Date(lapObj.TimeISO8601)
      );
      lap.type = lapObj.Type;

      lap.summary = this.getSummary(lapObj);
      activity.addLap(lap);
      nextLapStartDate = lap.endDate;
    }

    activity.sortPointsByDate();
    activity.endDate = activity.getEndPoint().getDate();

    // If no IBI return
    if (eventJSONObject.DeviceLog['R-R'] && eventJSONObject.DeviceLog['R-R'].Data) {
      activity.ibiData = new IBIData(eventJSONObject.DeviceLog['R-R'].Data);
      // Create a second IBIData so we can have filtering on those with keeping the original
      (new IBIData(eventJSONObject.DeviceLog['R-R'].Data))
        .lowLimitBPMFilter()
        .highLimitBPMFilter()
        .lowPassFilter()
        .movingMedianFilter()
        .getAsBPM().forEach((value, key, map) => {
        const point = new Point(new Date(activity.startDate.getTime() + key));
        point.addData(new DataHeartRate(value));
        activity.addPoint(point);
      });
    }
    return event;
  }

  private static getPointsFromSamples(samples: any[]): PointInterface[] {
    return samples.reduce((pointsArray, sample) => {
      // Skip unwanted samples
      if (sample.Debug || sample.Events) {
        return pointsArray;
      }
      const point = new Point(new Date(sample.TimeISO8601));
      if (sample.hasOwnProperty('HR')) {
        point.addData(new DataHeartRate(sample.HR * 60))
      }
      if (sample.hasOwnProperty('GPSAltitude')) {
        point.addData(new DataGPSAltitude(sample.GPSAltitude))
      }
      if (sample.hasOwnProperty('Latitude')) {
        point.addData(new DataLatitudeDegrees(sample.Latitude * (180 / Math.PI)))
      }
      if (sample.hasOwnProperty('Longitude')) {
        point.addData(new DataLongitudeDegrees(sample.Longitude * (180 / Math.PI)))
      }
      if (sample.hasOwnProperty('AbsPressure')) {
        point.addData(new DataAbsolutePressure(sample.AbsPressure / 1000))
      }
      if (sample.hasOwnProperty('SeaLevelPressure')) {
        point.addData(new DataSeaLevelPressure(sample.SeaLevelPressure / 1000))
      }
      if (sample.hasOwnProperty('Altitude')) {
        point.addData(new DataAltitude(sample.Altitude))
      }
      if (sample.hasOwnProperty('Cadence')) {
        point.addData(new DataCadence(sample.Cadence * 120))
      }
      if (sample.hasOwnProperty('Power')) {
        point.addData(new DataPower(sample.Power))
      }
      if (sample.hasOwnProperty('Speed')) {
        point.addData(new DataSpeed(sample.Speed))
      }
      if (sample.hasOwnProperty('Temperature')) {
        point.addData(new DataTemperature(sample.Temperature - 273.15))
      }
      if (sample.hasOwnProperty('VerticalSpeed')) {
        point.addData(new DataVerticalSpeed(sample.VerticalSpeed))
      }
      if (sample.hasOwnProperty('EHPE')) {
        point.addData(new DataEHPE(sample.EHPE));
      }
      if (sample.hasOwnProperty('EVPE')) {
        point.addData(new DataEVPE(sample.EVPE));
      }
      if (sample.hasOwnProperty('NumberOfSatellites')) {
        point.addData(new DataNumberOfSatellites(sample.NumberOfSatellites));
      }
      if (sample.hasOwnProperty('Satellite5BestSNR')) {
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
    summary.pauseDurationInSeconds = object.PauseDuration;
    summary.recoveryTimeInSeconds = object.RecoveryTime;
    summary.maxVO2 = object.MAXVO2;

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
      const zones = new IntensityZones;
      zones.zone1Duration = object.HrZones.Zone1Duration;
      zones.zone2Duration = object.HrZones.Zone2Duration;
      zones.zone2LowerLimit = Math.round(object.HrZones.Zone2LowerLimit * 60);
      zones.zone3Duration = object.HrZones.Zone3Duration;
      zones.zone3LowerLimit = Math.round(object.HrZones.Zone3LowerLimit * 60);
      zones.zone4Duration = object.HrZones.Zone4Duration;
      zones.zone4LowerLimit = Math.round(object.HrZones.Zone4LowerLimit * 60);
      zones.zone5Duration = object.HrZones.Zone5Duration;
      zones.zone5LowerLimit = Math.round(object.HrZones.Zone5LowerLimit * 60);
      summary.intensityZones.set(DataHeartRate.type, zones);
    }

    if (object.PowerZones) {
      const zones = new IntensityZones;
      zones.zone1Duration = object.PowerZones.Zone1Duration;
      zones.zone2Duration = object.PowerZones.Zone2Duration;
      zones.zone2LowerLimit = object.PowerZones.Zone2LowerLimit;
      zones.zone3Duration = object.PowerZones.Zone3Duration;
      zones.zone3LowerLimit = object.PowerZones.Zone3LowerLimit;
      zones.zone4Duration = object.PowerZones.Zone4Duration;
      zones.zone4LowerLimit = object.PowerZones.Zone4LowerLimit;
      zones.zone5Duration = object.PowerZones.Zone5Duration;
      zones.zone5LowerLimit = object.PowerZones.Zone5LowerLimit;
      summary.intensityZones.set(DataPower.type, zones);
    }

    if (object.SpeedZones) {
      const zones = new IntensityZones;
      zones.zone1Duration = object.SpeedZones.Zone1Duration;
      zones.zone2Duration = object.SpeedZones.Zone2Duration;
      zones.zone2LowerLimit = object.SpeedZones.Zone2LowerLimit;
      zones.zone3Duration = object.SpeedZones.Zone3Duration;
      zones.zone3LowerLimit = object.SpeedZones.Zone3LowerLimit;
      zones.zone4Duration = object.SpeedZones.Zone4Duration;
      zones.zone4LowerLimit = object.SpeedZones.Zone4LowerLimit;
      zones.zone5Duration = object.SpeedZones.Zone5Duration;
      zones.zone5LowerLimit = object.SpeedZones.Zone5LowerLimit;
      summary.intensityZones.set(DataSpeed.type, zones);
    }
    return summary;
  }

  private static getActivityTypeFromID(id: number): string {
    switch (id) {
      case 3: {
        return 'Running';
      }
      case 23: {
        return 'Weight Training'
      }
      case 82: {
        return 'Trail Running'
      }
    }
    return 'Unknown'
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
