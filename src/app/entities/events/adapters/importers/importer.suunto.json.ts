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
import {DataGPSAltitude} from '../../../data/data.gps-altitude';
import {DataAbsolutePressure} from '../../../data/data.absolute-pressure';
import {DataEHPE} from '../../../data/data.ehpe';
import {DataEVPE} from '../../../data/data.evpe';
import {DataNumberOfSatellites} from '../../../data/data.number-of-satellites';
import {DataSatellite5BestSNR} from '../../../data/data.satellite-5-best-snr';
import {Summary} from '../../../summary/summary';
import {IntensityZones} from '../../../intensity-zones/intensity-zone';
import {IBIFilters} from '../../../data/ibi/data.ibi.filters';
import {IBIData} from '../../../data/ibi/data.ibi';

export class EventImporterSuuntoJSON {

  static getFromJSONString(jsonString: string, id?: string): EventInterface {

    const eventJSONObject = JSON.parse(jsonString);
    const event = new Event();

    // @todo iterate over activities
    const activity = new Activity();
    activity.setStartDate(new Date(eventJSONObject.DeviceLog.Header.DateTime));
    activity.setType(this.getActivityTypeFromID(eventJSONObject.DeviceLog.Header.ActivityType));
    const activitySummary = new Summary();
    activitySummary.totalDistanceInMeters = eventJSONObject.DeviceLog.Header.Distance;
    activitySummary.totalDurationInSeconds = eventJSONObject.DeviceLog.Header.Duration;
    activitySummary.maxAltitudeInMeters = eventJSONObject.DeviceLog.Header.Altitude.Max;
    activitySummary.minAltitudeInMeters = eventJSONObject.DeviceLog.Header.Altitude.Min;
    activitySummary.ascentTimeInSeconds = eventJSONObject.DeviceLog.Header.AscentTime;
    activitySummary.descentTimeInSeconds = eventJSONObject.DeviceLog.Header.DescentTime;
    activitySummary.ascentInMeters = eventJSONObject.DeviceLog.Header.Ascent;
    activitySummary.descentInMeters = eventJSONObject.DeviceLog.Header.Descent;
    activitySummary.epoc = eventJSONObject.DeviceLog.Header.EPOC;
    activitySummary.energyInCal = eventJSONObject.DeviceLog.Header.Energy * 0.239 / 1000;
    activitySummary.feeling = eventJSONObject.DeviceLog.Header.Feeling;
    activitySummary.peakTrainingEffect = eventJSONObject.DeviceLog.Header.PeakTrainingEffect;
    activitySummary.pauseDurationInSeconds = eventJSONObject.DeviceLog.Header.PauseDuration;
    activitySummary.recoveryTimeInSeconds = eventJSONObject.DeviceLog.Header.RecoveryTime;
    activitySummary.maxVO2 = eventJSONObject.DeviceLog.Header.MAXVO2;
    if (eventJSONObject.DeviceLog.Header.HR) {
      activitySummary.avgHR = eventJSONObject.DeviceLog.Header.HR[0].Avg * 60;
      activitySummary.maxHR = eventJSONObject.DeviceLog.Header.HR[0].Max * 60;
      activitySummary.minHR = eventJSONObject.DeviceLog.Header.HR[0].Min * 60;
    }

    if (eventJSONObject.DeviceLog.Header.Cadence) {
      activitySummary.avgCadence = eventJSONObject.DeviceLog.Header.Cadence[0].Avg * 60 * 2;
      activitySummary.maxCadence = eventJSONObject.DeviceLog.Header.Cadence[0].Max * 60 * 2;
      activitySummary.minCadence = eventJSONObject.DeviceLog.Header.Cadence[0].Min * 60 * 2;
    }

    if (eventJSONObject.DeviceLog.Header.Power) {
      activitySummary.avgPower = eventJSONObject.DeviceLog.Header.Power[0].Avg;
      activitySummary.maxPower = eventJSONObject.DeviceLog.Header.Power[0].Max;
      activitySummary.minPower = eventJSONObject.DeviceLog.Header.Power[0].Min;
    }

    if (eventJSONObject.DeviceLog.Header.Speed) {
      activitySummary.avgSpeed = eventJSONObject.DeviceLog.Header.Speed[0].Avg;
      activitySummary.maxSpeed = eventJSONObject.DeviceLog.Header.Speed[0].Max;
      activitySummary.minSpeed = eventJSONObject.DeviceLog.Header.Speed[0].Min;
    }

    if (eventJSONObject.DeviceLog.Header.Temperature) {
      activitySummary.avgTemperature = eventJSONObject.DeviceLog.Header.Temperature[0].Avg - 273.15;
      activitySummary.maxTemperature = eventJSONObject.DeviceLog.Header.Temperature[0].Max - 273.15;
      activitySummary.minTemperature = eventJSONObject.DeviceLog.Header.Temperature[0].Min - 273.15;
    }

    if (eventJSONObject.DeviceLog.Header.VerticalSpeed) {
      activitySummary.avgVerticalSpeed = eventJSONObject.DeviceLog.Header.VerticalSpeed[0].Avg;
      activitySummary.maxVerticalSpeed = eventJSONObject.DeviceLog.Header.VerticalSpeed[0].Max;
      activitySummary.minVerticalSpeed = eventJSONObject.DeviceLog.Header.VerticalSpeed[0].Min;
    }

    if (eventJSONObject.DeviceLog.Header.HrZones) {
      const zones = new IntensityZones;
      zones.zone1Duration = eventJSONObject.DeviceLog.Header.HrZones.Zone1Duration;
      zones.zone2Duration = eventJSONObject.DeviceLog.Header.HrZones.Zone2Duration;
      zones.zone2LowerLimit = Math.round(eventJSONObject.DeviceLog.Header.HrZones.Zone2LowerLimit * 60);
      zones.zone3Duration = eventJSONObject.DeviceLog.Header.HrZones.Zone3Duration;
      zones.zone3LowerLimit = Math.round(eventJSONObject.DeviceLog.Header.HrZones.Zone3LowerLimit * 60);
      zones.zone4Duration = eventJSONObject.DeviceLog.Header.HrZones.Zone4Duration;
      zones.zone4LowerLimit = Math.round(eventJSONObject.DeviceLog.Header.HrZones.Zone4LowerLimit * 60);
      zones.zone5Duration = eventJSONObject.DeviceLog.Header.HrZones.Zone5Duration;
      zones.zone5LowerLimit = Math.round(eventJSONObject.DeviceLog.Header.HrZones.Zone5LowerLimit * 60);
      activitySummary.intensityZones.set(DataHeartRate.type, zones);
    }

    if (eventJSONObject.DeviceLog.Header.PowerZones) {
      const zones = new IntensityZones;
      zones.zone1Duration = eventJSONObject.DeviceLog.Header.PowerZones.Zone1Duration;
      zones.zone2Duration = eventJSONObject.DeviceLog.Header.PowerZones.Zone2Duration;
      zones.zone2LowerLimit = eventJSONObject.DeviceLog.Header.PowerZones.Zone2LowerLimit;
      zones.zone3Duration = eventJSONObject.DeviceLog.Header.PowerZones.Zone3Duration;
      zones.zone3LowerLimit = eventJSONObject.DeviceLog.Header.PowerZones.Zone3LowerLimit;
      zones.zone4Duration = eventJSONObject.DeviceLog.Header.PowerZones.Zone4Duration;
      zones.zone4LowerLimit = eventJSONObject.DeviceLog.Header.PowerZones.Zone4LowerLimit;
      zones.zone5Duration = eventJSONObject.DeviceLog.Header.PowerZones.Zone5Duration;
      zones.zone5LowerLimit = eventJSONObject.DeviceLog.Header.PowerZones.Zone5LowerLimit;
      activitySummary.intensityZones.set(DataPower.type, zones);
    }

    if (eventJSONObject.DeviceLog.Header.SpeedZones) {
      const zones = new IntensityZones;
      zones.zone1Duration = eventJSONObject.DeviceLog.Header.SpeedZones.Zone1Duration;
      zones.zone2Duration = eventJSONObject.DeviceLog.Header.SpeedZones.Zone2Duration;
      zones.zone2LowerLimit = eventJSONObject.DeviceLog.Header.SpeedZones.Zone2LowerLimit;
      zones.zone3Duration = eventJSONObject.DeviceLog.Header.SpeedZones.Zone3Duration;
      zones.zone3LowerLimit = eventJSONObject.DeviceLog.Header.SpeedZones.Zone3LowerLimit;
      zones.zone4Duration = eventJSONObject.DeviceLog.Header.SpeedZones.Zone4Duration;
      zones.zone4LowerLimit = eventJSONObject.DeviceLog.Header.SpeedZones.Zone4LowerLimit;
      zones.zone5Duration = eventJSONObject.DeviceLog.Header.SpeedZones.Zone5Duration;
      zones.zone5LowerLimit = eventJSONObject.DeviceLog.Header.SpeedZones.Zone5LowerLimit;
      activitySummary.intensityZones.set(DataSpeed.type, zones);
    }


    activity.setSummary(activitySummary);
    event.addActivity(activity);

    const eventSummary = new Summary();
    eventSummary.totalDurationInSeconds = activitySummary.totalDurationInSeconds;
    eventSummary.totalDistanceInMeters = activitySummary.totalDistanceInMeters;

    event.setSummary(eventSummary);

    const creator = new Creator();
    creator.setName(this.getDeviceModelFromCodeName(eventJSONObject.DeviceLog.Device.Name)); // Should show model
    creator.setSerialNumber(eventJSONObject.DeviceLog.Device.SerialNumber);
    creator.setHWInfo(eventJSONObject.DeviceLog.Device.Info.HW);
    creator.setSWInfo(eventJSONObject.DeviceLog.Device.Info.SW);
    activity.setCreator(creator);

    for (const sample of eventJSONObject.DeviceLog.Samples) {
      // Skip unwanted samples
      if (sample.Debug || sample.Events) {
        continue;
      }
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

    // Important

    // Parse the laps
    let nextLapStartDate = event.getFirstActivity().getStartDate();
    for (const lapWindow of eventJSONObject.DeviceLog.Windows) {
      const lapObj = lapWindow.Window;
      if (lapObj.Type !== 'Autolap') {
        continue;
      }
      const lap = new Lap(
        nextLapStartDate,
        new Date(lapObj.TimeISO8601)
      );
      const lapSummary = new Summary();
      lap.type = lapObj.Type;
      lapSummary.totalDistanceInMeters = lapObj.Distance;
      lapSummary.totalDurationInSeconds =  lapObj.Duration;
      lapSummary.maxAltitudeInMeters = lapObj.Altitude[0].Max;
      lapSummary.minAltitudeInMeters = lapObj.Altitude[0].Min;
      lapSummary.ascentTimeInSeconds = lapObj.AscentTime;
      lapSummary.descentTimeInSeconds = lapObj.DescentTime;
      lapSummary.ascentInMeters = lapObj.Ascent;
      lapSummary.descentInMeters = lapObj.Descent;
      lapSummary.epoc = lapObj.EPOC;
      lapSummary.energyInCal = lapObj.Energy * 0.239 / 1000;
      lapSummary.feeling = lapObj.Feeling;
      lapSummary.peakTrainingEffect = lapObj.PeakTrainingEffect;
      lapSummary.pauseDurationInSeconds = lapObj.PauseDuration;
      lapSummary.recoveryTimeInSeconds = lapObj.RecoveryTime;
      lapSummary.maxVO2 = lapObj.MAXVO2;

      if (lapObj.HR) {
        lapSummary.avgHR = lapObj.HR[0].Avg * 60;
        lapSummary.maxHR = lapObj.HR[0].Max * 60;
        lapSummary.minHR = lapObj.HR[0].Min * 60;
      }

      if (lapObj.Cadence) {
        lapSummary.avgCadence = lapObj.Cadence[0].Avg * 60 * 2;
        lapSummary.maxCadence = lapObj.Cadence[0].Max * 60 * 2;
        lapSummary.minCadence = lapObj.Cadence[0].Min * 60 * 2;
      }

      if (lapObj.Power) {
        lapSummary.avgPower = lapObj.Power[0].Avg;
        lapSummary.maxPower = lapObj.Power[0].Max;
        lapSummary.minPower = lapObj.Power[0].Min;
      }

      if (lapObj.Speed) {
        lapSummary.avgSpeed = lapObj.Speed[0].Avg;
        lapSummary.maxSpeed = lapObj.Speed[0].Max;
        lapSummary.minSpeed = lapObj.Speed[0].Min;
      }

      if (lapObj.Temperature) {
        lapSummary.avgTemperature = lapObj.Temperature[0].Avg - 273.15;
        lapSummary.maxTemperature = lapObj.Temperature[0].Max - 273.15;
        lapSummary.minTemperature = lapObj.Temperature[0].Min - 273.15;
      }

      if (lapObj.VerticalSpeed) {
        lapSummary.avgVerticalSpeed = lapObj.VerticalSpeed[0].Avg;
        lapSummary.maxVerticalSpeed = lapObj.VerticalSpeed[0].Max;
        lapSummary.minVerticalSpeed = lapObj.VerticalSpeed[0].Min;
      }

      lap.summary = lapSummary;
      activity.addLap(lap);
      nextLapStartDate = lap.endDate;
    }

    activity.sortPointsByDate();
    activity.setEndDate(activity.getEndPoint().getDate());

    // If no IBI return
    if (eventJSONObject.DeviceLog['R-R'] && eventJSONObject.DeviceLog['R-R'].Data) {
      activity.setIBIData(new IBIData(eventJSONObject.DeviceLog['R-R'].Data));
      // Create a second IBIData so we can have filtering on those with keeping the original
      (new IBIData(eventJSONObject.DeviceLog['R-R'].Data))
        .lowLimitBPMFilter()
        .highLimitBPMFilter()
        .lowPassFilter()
        .movingMedianFilter()
        .getAsBPM().forEach((value, key, map) => {
        const point = new Point(new Date(activity.getStartDate().getTime() + key));
        point.addData(new DataHeartRate(value));
        activity.addPoint(point);
      });
    }
    return event;
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
