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
import {Zones} from "../../../intensity-zones/intensity-zone";

export class EventImporterSuuntoJSON {
  static getFromJSONString(jsonString: string, id?: string): EventInterface {
    const eventJSONObject = JSON.parse(jsonString);
    const event = new Event();

    debugger;

    // @todo iterate over activities
    const activity = new Activity();
    activity.setStartDate(new Date(eventJSONObject.DeviceLog.Header.DateTime));
    activity.setType(this.getActivityTypeFromID(eventJSONObject.DeviceLog.Header.ActivityType));
    const activitySummary = new Summary();
    activitySummary.setTotalDistanceInMeters(eventJSONObject.DeviceLog.Header.Distance);
    activitySummary.setTotalDurationInSeconds(eventJSONObject.DeviceLog.Header.Duration);
    activitySummary.setMaxAltitudeInMeters(eventJSONObject.DeviceLog.Header.Altitude.Max);
    activitySummary.setMinAltitudeInMeters(eventJSONObject.DeviceLog.Header.Altitude.Min);
    activitySummary.setAscentTimeInSeconds(eventJSONObject.DeviceLog.Header.AscentTime);
    activitySummary.setDescentTimeInSeconds(eventJSONObject.DeviceLog.Header.DescentTime);
    activitySummary.setAscentInMeters(eventJSONObject.DeviceLog.Header.Ascent);
    activitySummary.setDescentInMeters(eventJSONObject.DeviceLog.Header.Descent);
    activitySummary.setEPOC(eventJSONObject.DeviceLog.Header.EPOC);
    activitySummary.setEnergyInCal(eventJSONObject.DeviceLog.Header.Energy * 0.239 / 1000);
    activitySummary.setFeeling(eventJSONObject.DeviceLog.Header.Feeling);
    activitySummary.setPeakTrainingEffect(eventJSONObject.DeviceLog.Header.PeakTrainingEffect);
    activitySummary.setPauseDurationInSeconds(eventJSONObject.DeviceLog.Header.PauseDuration);
    activitySummary.setRecoveryTimeInSeconds(eventJSONObject.DeviceLog.Header.RecoveryTime);
    activitySummary.setMaxVO2(eventJSONObject.DeviceLog.Header.MAXVO2);
    if (eventJSONObject.DeviceLog.Header.HR) {
      activitySummary.setAvgHR(eventJSONObject.DeviceLog.Header.HR[0].Avg * 60);
      activitySummary.setMaxHR(eventJSONObject.DeviceLog.Header.HR[0].Max * 60);
      activitySummary.setMinHR(eventJSONObject.DeviceLog.Header.HR[0].Min * 60);
    }

    if (eventJSONObject.DeviceLog.Header.Cadence) {
      activitySummary.setAvgCadence(eventJSONObject.DeviceLog.Header.Cadence[0].Avg * 60 * 2);
      activitySummary.setMaxCadence(eventJSONObject.DeviceLog.Header.Cadence[0].Max * 60 * 2);
      activitySummary.setMinCadence(eventJSONObject.DeviceLog.Header.Cadence[0].Min * 60 * 2);
    }

    if (eventJSONObject.DeviceLog.Header.Power) {
      activitySummary.setAvgPower(eventJSONObject.DeviceLog.Header.Power[0].Avg);
      activitySummary.setMaxPower(eventJSONObject.DeviceLog.Header.Power[0].Max);
      activitySummary.setMinPower(eventJSONObject.DeviceLog.Header.Power[0].Min);
    }

    if (eventJSONObject.DeviceLog.Header.Speed) {
      activitySummary.setAvgSpeed(eventJSONObject.DeviceLog.Header.Speed[0].Avg);
      activitySummary.setMaxSpeed(eventJSONObject.DeviceLog.Header.Speed[0].Max);
      activitySummary.setMinSpeed(eventJSONObject.DeviceLog.Header.Speed[0].Min);
    }

    if (eventJSONObject.DeviceLog.Header.Temperature) {
      activitySummary.setAvgTemperature(eventJSONObject.DeviceLog.Header.Temperature[0].Avg - 273.15);
      activitySummary.setMaxTemperature(eventJSONObject.DeviceLog.Header.Temperature[0].Max - 273.15);
      activitySummary.setMinTemperature(eventJSONObject.DeviceLog.Header.Temperature[0].Min - 273.15);
    }

    if (eventJSONObject.DeviceLog.Header.VerticalSpeed) {
      activitySummary.setAvgVerticalSpeed(eventJSONObject.DeviceLog.Header.VerticalSpeed[0].Avg);
      activitySummary.setMaxVerticalSpeed(eventJSONObject.DeviceLog.Header.VerticalSpeed[0].Max);
      activitySummary.setMinVerticalSpeed(eventJSONObject.DeviceLog.Header.VerticalSpeed[0].Min);
    }

    if (eventJSONObject.DeviceLog.Header.HrZones) {
      const zones = new Zones;
      zones.zone1Duration = eventJSONObject.DeviceLog.Header.HrZones.Zone1Duration;
      zones.zone2Duration = eventJSONObject.DeviceLog.Header.HrZones.Zone2Duration;
      zones.zone2LowerLimit = eventJSONObject.DeviceLog.Header.HrZones.Zone2LowerLimit;
      zones.zone3Duration = eventJSONObject.DeviceLog.Header.HrZones.Zone3Duration;
      zones.zone3LowerLimit = eventJSONObject.DeviceLog.Header.HrZones.Zone3LowerLimit;
      zones.zone4Duration = eventJSONObject.DeviceLog.Header.HrZones.Zone4Duration;
      zones.zone4LowerLimit = eventJSONObject.DeviceLog.Header.HrZones.Zone4LowerLimit;
      zones.zone5Duration = eventJSONObject.DeviceLog.Header.HrZones.Zone5Duration;
      zones.zone5LowerLimit = eventJSONObject.DeviceLog.Header.HrZones.Zone5LowerLimit;
      activitySummary.addIntensityZone('HrZones', zones);
    }

    if (eventJSONObject.DeviceLog.Header.PowerZones) {
      const zones = new Zones;
      zones.zone1Duration = eventJSONObject.DeviceLog.Header.PowerZones.Zone1Duration;
      zones.zone2Duration = eventJSONObject.DeviceLog.Header.PowerZones.Zone2Duration;
      zones.zone2LowerLimit = eventJSONObject.DeviceLog.Header.PowerZones.Zone2LowerLimit;
      zones.zone3Duration = eventJSONObject.DeviceLog.Header.PowerZones.Zone3Duration;
      zones.zone3LowerLimit = eventJSONObject.DeviceLog.Header.PowerZones.Zone3LowerLimit;
      zones.zone4Duration = eventJSONObject.DeviceLog.Header.PowerZones.Zone4Duration;
      zones.zone4LowerLimit = eventJSONObject.DeviceLog.Header.PowerZones.Zone4LowerLimit;
      zones.zone5Duration = eventJSONObject.DeviceLog.Header.PowerZones.Zone5Duration;
      zones.zone5LowerLimit = eventJSONObject.DeviceLog.Header.PowerZones.Zone5LowerLimit;
      activitySummary.addIntensityZone('PowerZones', zones);
    }

    if (eventJSONObject.DeviceLog.Header.SpeedZones) {
      const zones = new Zones;
      zones.zone1Duration = eventJSONObject.DeviceLog.Header.SpeedZones.Zone1Duration;
      zones.zone2Duration = eventJSONObject.DeviceLog.Header.SpeedZones.Zone2Duration;
      zones.zone2LowerLimit = eventJSONObject.DeviceLog.Header.SpeedZones.Zone2LowerLimit;
      zones.zone3Duration = eventJSONObject.DeviceLog.Header.SpeedZones.Zone3Duration;
      zones.zone3LowerLimit = eventJSONObject.DeviceLog.Header.SpeedZones.Zone3LowerLimit;
      zones.zone4Duration = eventJSONObject.DeviceLog.Header.SpeedZones.Zone4Duration;
      zones.zone4LowerLimit = eventJSONObject.DeviceLog.Header.SpeedZones.Zone4LowerLimit;
      zones.zone5Duration = eventJSONObject.DeviceLog.Header.SpeedZones.Zone5Duration;
      zones.zone5LowerLimit = eventJSONObject.DeviceLog.Header.SpeedZones.Zone5LowerLimit;
      activitySummary.addIntensityZone('SpeedZones', zones);
    }


    activity.setSummary(activitySummary);
    event.addActivity(activity);

    const eventSummary = new Summary();
    eventSummary.setTotalDurationInSeconds(activitySummary.getTotalDurationInSeconds());
    eventSummary.setTotalDistanceInMeters(activitySummary.getTotalDistanceInMeters());

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
      lap.setType(lapObj.Type);
      lapSummary.setTotalDistanceInMeters(lapObj.Distance);
      lapSummary.setTotalDurationInSeconds(lapObj.Duration);
      lapSummary.setMaxAltitudeInMeters(lapObj.Altitude[0].Max);
      lapSummary.setMinAltitudeInMeters(lapObj.Altitude[0].Min);
      lapSummary.setAscentTimeInSeconds(lapObj.AscentTime);
      lapSummary.setDescentTimeInSeconds(lapObj.DescentTime);
      lapSummary.setAscentInMeters(lapObj.Ascent);
      lapSummary.setDescentInMeters(lapObj.Descent);
      lapSummary.setEPOC(lapObj.EPOC);
      lapSummary.setEnergyInCal(lapObj.Energy * 0.239 / 1000);
      lapSummary.setFeeling(lapObj.Feeling);
      lapSummary.setPeakTrainingEffect(lapObj.PeakTrainingEffect);
      lapSummary.setPauseDurationInSeconds(lapObj.PauseDuration);
      lapSummary.setRecoveryTimeInSeconds(lapObj.RecoveryTime);
      lapSummary.setMaxVO2(lapObj.MAXVO2);

      if (lapObj.HR) {
        lapSummary.setAvgHR(lapObj.HR[0].Avg * 60);
        lapSummary.setMaxHR(lapObj.HR[0].Max * 60);
        lapSummary.setMinHR(lapObj.HR[0].Min * 60);
      }

      if (lapObj.Cadence) {
        lapSummary.setAvgCadence(lapObj.Cadence[0].Avg * 60 * 2);
        lapSummary.setMaxCadence(lapObj.Cadence[0].Max * 60 * 2);
        lapSummary.setMinCadence(lapObj.Cadence[0].Min * 60 * 2);
      }

      if (lapObj.Power) {
        lapSummary.setAvgPower(lapObj.Power[0].Avg);
        lapSummary.setMaxPower(lapObj.Power[0].Max);
        lapSummary.setMinPower(lapObj.Power[0].Min);
      }

      if (lapObj.Speed) {
        lapSummary.setAvgSpeed(lapObj.Speed[0].Avg);
        lapSummary.setMaxSpeed(lapObj.Speed[0].Max);
        lapSummary.setMinSpeed(lapObj.Speed[0].Min);
      }

      if (lapObj.Temperature) {
        lapSummary.setAvgTemperature(lapObj.Temperature[0].Avg - 273.15);
        lapSummary.setMaxTemperature(lapObj.Temperature[0].Max - 273.15);
        lapSummary.setMinTemperature(lapObj.Temperature[0].Min - 273.15);
      }

      if (lapObj.VerticalSpeed) {
        lapSummary.setAvgVerticalSpeed(lapObj.VerticalSpeed[0].Avg);
        lapSummary.setMaxVerticalSpeed(lapObj.VerticalSpeed[0].Max);
        lapSummary.setMinVerticalSpeed(lapObj.VerticalSpeed[0].Min);
      }

      lap.setSummary(lapSummary);
      event.addLap(lap);
      nextLapStartDate = lap.getEndDate();
    }

    activity.sortPointsByDate();
    activity.setEndDate(activity.getEndPoint().getDate());


    // If no IBI return
    if (!eventJSONObject.DeviceLog["R-R"] || !eventJSONObject.DeviceLog["R-R"].Data) {
      debugger;
      return event
    }

    activity.setRRData(eventJSONObject.DeviceLog["R-R"].Data);

    // Go over the IBI
    let ibiBuffer = [];
    let lastDate = event.getFirstActivity().getStartDate();
    for (const ibiInMilliseconds of eventJSONObject.DeviceLog["R-R"].Data) {
      ibiBuffer.push(ibiInMilliseconds);
      const ibiBufferTotal = ibiBuffer.reduce((a, b) => a + b, 0);
      // If adding the ibi to the start of the activity is greater or equal to 2.5 second then empty the buffer there
      if ((lastDate.getTime() + ibiBufferTotal) >= lastDate.getTime() + 2500) {
        const average = ibiBuffer.reduce((total, ibi) => {
          return total + ibi;
        }) / ibiBuffer.length;

        // Find existing points
        // @todo optimize
        const eventPoints = event.getPoints(new Date(lastDate.getTime()), new Date(lastDate.getTime() + ibiInMilliseconds));
        for (const eventPoint of eventPoints) {
          eventPoint.addData(new DataHeartRate(1000 * 60 / average)); // @todo investigate 1000 magic number
        }

        ibiBuffer = [];
        lastDate = new Date(lastDate.getTime() + ibiBufferTotal);
      }
    }

    debugger;
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

  private static getDeviceModelFromCodeName(codeName: string): string{
    switch (codeName) {
      case 'Amsterdam': {
        return 'Spartan Ultra';
      }
      case 'Ibiza': {
        return 'Ultra X'
      }
      case 'Brighton': {
        return 'Spartan Sport'
      }
      case 'Cairo': {
        return 'Spartan Wrist HR'
      }
      case 'Forssa': {
        return 'Spartan Trainer'
      }
      case 'Gdansk': {
        return 'Spartan Wrist HR Baro'
      }
      case 'Helsinki': {
        return '3 Fitness'
      }
    }
    return codeName;
  }

}
