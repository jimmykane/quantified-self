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
import {ImporterSuuntoActivityIds} from './importer.suunto.activity.ids';
import {ImporterSuuntoDeviceNames} from './importer.suunto.device.names';
import {ActivityInterface} from '../../../../activities/activity.interface';
import {LapInterface} from '../../../../laps/lap.interface';

export class EventImporterSuuntoJSON {

  static getFromJSONString(jsonString: string): EventInterface {
    const eventJSONObject = JSON.parse(jsonString);
    debugger;

    // Populate the event summary from the Header Object
    const event = new Event();
    event.summary = this.getSummary(eventJSONObject.DeviceLog.Header);

    // Create a creator and pass it to all activities (later)
    const creator = new Creator();
    creator.name = ImporterSuuntoDeviceNames[eventJSONObject.DeviceLog.Device.Name] || eventJSONObject.DeviceLog.Device.Name;
    creator.serialNumber = eventJSONObject.DeviceLog.Device.SerialNumber;
    creator.hwInfo = eventJSONObject.DeviceLog.Device.Info.HW;
    creator.swInfo = eventJSONObject.DeviceLog.Device.Info.SW;

    // Go over the samples and get the ones with activity start times
    const activityStartEventSamples = eventJSONObject.DeviceLog.Samples.filter((sample) => {
      return sample.Events && sample.Events[0].Activity;
    });

    // Get the lap start events
    const lapEventSamples = eventJSONObject.DeviceLog.Samples.filter((sample) => {
      return sample.Events && sample.Events[0].Lap && sample.Events[0].Lap.Type !== 'Start' && sample.Events[0].Lap.Type !== 'Stop';
    });

    // Get the stop event
    const stopEventSample = eventJSONObject.DeviceLog.Samples.find((sample) => {
      return sample.Events && sample.Events[0].Lap && sample.Events[0].Lap.Type === 'Stop';
    });

    // Add the stop event to the laps since it's also a lap stop event
    lapEventSamples.push(stopEventSample);

    // Get the activity windows
    const activityWindows = eventJSONObject.DeviceLog.Windows.filter((windowObj) => {
      return windowObj.Window.Type === 'Activity';
    }).map(activityWindow => {
      return activityWindow.Window
    });

    // Get the lap windows
    const lapWindows = eventJSONObject.DeviceLog.Windows.filter((windowObj) => {
      return windowObj.Window.Type === 'Lap' || windowObj.Window.Type === 'Autolap';
    }).map(lapWindow => {
      return lapWindow.Window
    });

    // Get the move window
    const moveWindow = eventJSONObject.DeviceLog.Windows.find((windowObj) => {
      return windowObj.Window.Type === 'Move';
    }).Window;

    // Create the activities
    const activities = activityStartEventSamples.map((activityStartEventSample, index): ActivityInterface => {
      const activity = new Activity();
      activity.startDate = new Date(activityStartEventSample.TimeISO8601);
      activity.type = ImporterSuuntoActivityIds[activityStartEventSample.Events[0].Activity.ActivityType];
      activity.creator = creator;
      // Set the end date to the stop event time if the activity is the last or the only one else set it on the next itery time
      activity.endDate = activityStartEventSamples.length - 1 === index ?
        new Date(stopEventSample.TimeISO8601) :
        new Date(activityStartEventSamples[index + 1].TimeISO8601);
      // Create a summary these are a 1:1 ref arrays
      activity.summary = this.getSummary(activityWindows[index]);
      return activity;
    });

    // Create the laps
    const laps = lapEventSamples.map((lapEventSample, index): LapInterface => {
      const lapStartDate = index === 0 ? activities[0].startDate : new Date(lapEventSamples[index - 1].TimeISO8601);
      const lapEndDate = new Date(lapEventSample.TimeISO8601);
      const lap = new Lap(lapStartDate, lapEndDate);
      lap.type = lapEventSample;
      // if it's only one lap there is no summary as it's the whole activity
      if (lapEventSamples.length !== 1) {
        lap.summary = this.getSummary(lapWindows[index]);
        lap.type = lapWindows[index].Type;
      }
      return lap;
    });

    // Add the laps to the belonging activity. If a lap starts or stops at the activity date delta then it belong to the acitvity
    // @todo move laps to event so we don't have cross border laps to acivities and decouple them
    activities.forEach((activity: ActivityInterface) => {
      laps.filter((lap: LapInterface) => {
        // If the lap start belongs to the activity
        if (lap.startDate <= activity.endDate && lap.startDate >= activity.startDate) {
          return true;
        }
        // if the lap end belongs also...
        if (lap.endDate >= activity.startDate && lap.endDate <= activity.endDate) {
          return true
        }
        return false;
      }).forEach((activityLap, index, activityLapArray) => {
        // Fix the summary if only one lap (whole activity) @todo fix later
        if (activityLapArray.length === 1) {
          activityLap.summary = Object.create(activity.summary);
          activityLap.type = 'Total';
        }
        activity.addLap(activityLap);
      });
    });

    // Add the samples that belong to the activity and the ibi data.
    activities.every((activity) => {
      eventJSONObject.DeviceLog.Samples.forEach((sample) => {
        const point = this.getPointFromSample(sample);
        if (point && point.getDate() >= activity.startDate && point.getDate() <= activity.endDate) {
          activity.addPoint(point)
        }
      });
    });

    // Add the ibiData
    if (eventJSONObject.DeviceLog['R-R'] && eventJSONObject.DeviceLog['R-R'].Data) {
      // prepare the data array per activity removing the offset
      activities.forEach((activity, activityIndex) => {
        let timeSum = 0;
        const ibiData = eventJSONObject.DeviceLog['R-R'].Data.filter((ibi) => {
          timeSum += ibi;
          const ibiDataDate = new Date(activities[0].startDate.getTime() + timeSum);
          return ibiDataDate >= activity.startDate && ibiDataDate <= activity.endDate;
        });
        this.setIBIData(activity, ibiData)
      });
    }

    // Add the activities to the event
    activities.forEach((activity) => {
      event.addActivity(activity);
    });

    debugger;

    return event;
  }

  private static setIBIData(activity: Activity, ibiData: number[]) {
    activity.ibiData = new IBIData(ibiData);
    // @todo optimize
    // Create a second IBIData so we can have filtering on those with keeping the original
    (new IBIData(ibiData))
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

  private static getPointFromSample(sample: any): PointInterface {
    // Skip unwanted sample
    if (sample.Debug || sample.Events) {
      return null;
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
    return point;
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

    if (object.hasOwnProperty('VerticalSpeed')) {
      // Double action here
      if (Array.isArray(object.VerticalSpeed)) {
        summary.avgVerticalSpeed = object.VerticalSpeed[0].Avg;
        summary.maxVerticalSpeed = object.VerticalSpeed[0].Max;
        summary.minVerticalSpeed = object.VerticalSpeed[0].Min;
      } else {
        summary.avgVerticalSpeed = object.VerticalSpeed;
      }
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
}
