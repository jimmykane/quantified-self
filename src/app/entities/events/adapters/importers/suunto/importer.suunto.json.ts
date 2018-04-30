import {Event} from '../../../event';
import {Activity} from '../../../../activities/activity';
import {Creator} from '../../../../creators/creator';
import {Lap} from '../../../../laps/lap';
import {Point} from '../../../../points/point';
import {DataAltitude} from '../../../../data/data.altitude';
import {DataCadence} from '../../../../data/data.cadence';
import {DataHeartRate} from '../../../../data/data.heart-rate';
import {DataSpeed} from '../../../../data/data.speed';
import {DataVerticalSpeed} from '../../../../data/data.vertical-speed';
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
import {IntensityZones} from '../../../../intensity-zones/intensity-zone';
import {IBIData} from '../../../../data/ibi/data.ibi';
import {PointInterface} from '../../../../points/point.interface';
import {ImporterSuuntoActivityIds} from './importer.suunto.activity.ids';
import {ImporterSuuntoDeviceNames} from './importer.suunto.device.names';
import {ActivityInterface} from '../../../../activities/activity.interface';
import {LapInterface} from '../../../../laps/lap.interface';
import {DataInterface} from '../../../../data/data.interface';
import {DataDuration} from '../../../../data/data.duration';
import {DataAltitudeMax} from '../../../../data/data.altitude-max';
import {DataDistance} from '../../../../data/data.distance';
import {DataAscentTime} from '../../../../data/data.ascent-time';
import {DataDescentTime} from '../../../../data/data.descent-time';
import {DataDescent} from '../../../../data/data.descent';
import {DataAscent} from '../../../../data/data.ascent';
import {DataEPOC} from '../../../../data/data.epoc';
import {DataEnergy} from '../../../../data/data.energy';
import {DataFeeling} from '../../../../data/data.feeling';
import {DataPeakTrainingEffect} from '../../../../data/data.peak-training-effect';
import {DataRecovery} from '../../../../data/data.recovery';
import {DataVO2Max} from '../../../../data/data.vo2-max';
import {DataPause} from '../../../../data/data.pause';
import {DataHeartRateAvg} from '../../../../data/data.heart-rate-avg';
import {DataHeartRateMax} from '../../../../data/data.heart-rate-max';
import {DataHeartRateMin} from '../../../../data/data.heart-rate-min';
import {DataCadenceAvg} from '../../../../data/data.cadence-avg';
import {DataCadenceMax} from '../../../../data/data.cadence-max';
import {DataCadenceMin} from '../../../../data/data.cadence-min';
import {DataPowerAvg} from '../../../../data/data.power-avg';
import {DataPowerMax} from '../../../../data/data.power-max';
import {DataPowerMin} from '../../../../data/data.power-min';
import {DataSpeedAvg} from '../../../../data/data.speed-avg';
import {DataSpeedMax} from '../../../../data/data.speed-max';
import {DataSpeedMin} from '../../../../data/data.speed-min';
import {DataTemperatureAvg} from '../../../../data/data.temperature-avg';
import {DataTemperatureMax} from '../../../../data/data.temperature-max';
import {DataTemperatureMin} from '../../../../data/data.temperature-min';
import {DataVerticalSpeedAvg} from '../../../../data/data.vertical-speed-avg';
import {DataVerticalSpeedMax} from '../../../../data/data.vertical-speed-max';
import {DataVerticalSpeedMin} from '../../../../data/data.vertical-speed-min';
import {DataAltitudeAvg} from '../../../../data/data.altitude-avg';
import {DataAltitudeMin} from '../../../../data/data.altitude-min';
import {DataFusedLocation} from '../../../../data/data.fused-location';

export class EventImporterSuuntoJSON {

  static getFromJSONString(jsonString: string): EventInterface {
    const eventJSONObject = JSON.parse(jsonString);

    // Create an event
    const event = new Event();

    // Populate the event stats from the Header Object
    this.getStats(eventJSONObject.DeviceLog.Header).forEach((stat) => {
      event.addStat(stat)
    });

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
    // const moveWindow = eventJSONObject.DeviceLog.Windows.find((windowObj) => {
    //   return windowObj.Window.Type === 'Move';
    // }).Window;

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
      // Create the stats these are a 1:1 ref arrays
      this.getStats(activityWindows[index]).forEach((stat) => {
        activity.addStat(stat)
      });
      // Add the pause from end date minurs start date and removing the duration as widows do not contain the pause time
      activity.setPause(new DataPause((activity.endDate.getTime() - activity.startDate.getTime()) / 1000 - activity.getDuration().getValue()));
      // Set the zones for the activity @todo fix
      this.setIntensityZones(activity, eventJSONObject.DeviceLog.Header);

      return activity;
    });

    // set the start dates of all lap types to the start of the first activity
    const lapStartDatesByType = lapEventSamples.reduce((lapStartDatesByTypeObject, lapEventSample, index) => {
      // If its a stop event then set the start date to the previous
      if (lapEventSample.Events[0].Lap.Type === 'Stop' && lapEventSamples.length > 1) {
        lapStartDatesByTypeObject[lapEventSample.Events[0].Lap.Type] = new Date(lapEventSamples[index - 1].TimeISO8601);
        return lapStartDatesByTypeObject
      }
      lapStartDatesByTypeObject[lapEventSample.Events[0].Lap.Type] = activities[0].startDate;
      return lapStartDatesByTypeObject;
    }, {});
    const laps = lapEventSamples.reduce((lapArray, lapEventSample, index): LapInterface => {
      // if there is only one lap then skip it's the whole activity
      if (lapEventSamples.length === 1) {
        return lapArray;
      }
      // Set the end date
      const lapEndDate = new Date(lapEventSample.TimeISO8601);
      // Set the start date.
      const lap = new Lap(lapStartDatesByType[lapEventSample.Events[0].Lap.Type], lapEndDate);
      // Set it for the next run
      lapStartDatesByType[lapEventSample.Events[0].Lap.Type] = lapEndDate;
      lap.type = lapEventSample.Events[0].Lap.Type;

      this.getStats(lapWindows[index]).forEach((stat) => {
        lap.addStat(stat);
      });
      lap.type = lapWindows[index].Type;
      // Add the pause from end date minurs start date and removing the duration as widows do not contain the pause time
      lap.setPause(new DataPause((lap.endDate.getTime() - lap.startDate.getTime()) / 1000 - lap.getDuration().getValue()));
      lapArray.push(lap);
      return lapArray;
    }, []);

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
      }).forEach((activityLap: LapInterface, index, activityLapArray) => {
        activity.addLap(activityLap);
      });
    });

    // Add the samples that belong to the activity and the ibi data.
    activities.every((activity) => {
      eventJSONObject.DeviceLog.Samples.forEach((sample) => {
        const point = this.getPointFromSample(sample);
        // Checked for fused location on the sample
        if (point && point.getDate() >= activity.startDate && point.getDate() <= activity.endDate) {
          // add the point
          activity.addPoint(point);
          // if the point has fusedLocation data mark the activity by adding a stat
          if (this.hasFusedLocData(sample)) {
            activity.addStat(new DataFusedLocation(true)); // @todo mircooptimize here
          }
        }
      });
      activity.sortPointsByDate();
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
    activities.forEach((activity: ActivityInterface) => {
      event.addActivity(activity);
    });

    return event;
  }

  private static hasFusedLocData(sample): boolean {
    return !!sample.Inertial;
  }

  private static setIntensityZones(activity: ActivityInterface, object) {
    // Create intensity zones from the header
    if (object.HrZones) {
      activity.intensityZones.set(DataHeartRate.type, this.getZones(object.HrZones));
    }

    if (object.PowerZones) {
      activity.intensityZones.set(DataPower.type, this.getZones(object.PowerZones));
    }

    if (object.SpeedZones) {
      activity.intensityZones.set(DataSpeed.type, this.getZones(object.SpeedZones));
    }
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
      } else {
        debugger;
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

  private static getZones(zonesObj: any): IntensityZones {
    // @todo fix for HR
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

  private static getStats(object: any): DataInterface[] {
    const stats = [];
    if (object.hasOwnProperty('Distance') && object.Distance !== null) {
      stats.push(new DataDistance(object.Distance));
    }
    if (object.hasOwnProperty('AscentTime') && object.AscentTime !== null) {
      stats.push(new DataAscentTime(object.AscentTime));
    }

    if (object.hasOwnProperty('DescentTime') && object.DescentTime !== null) {
      stats.push(new DataDescentTime(object.DescentTime));
    }

    if (object.hasOwnProperty('Ascent') && object.Ascent !== null) {
      stats.push(new DataAscent(object.Ascent));
    }

    if (object.hasOwnProperty('Descent') && object.Descent !== null) {
      stats.push(new DataDescent(object.Descent));
    }

    if (object.hasOwnProperty('EPOC') && object.EPOC !== null) {
      stats.push(new DataEPOC(object.EPOC));
    }

    if (object.hasOwnProperty('Energy') && object.Energy !== null) {
      stats.push(new DataEnergy(object.Energy * 0.239 / 1000));
    }

    if (object.hasOwnProperty('Feeling') && object.Feeling !== null) {
      stats.push(new DataFeeling(object.Feeling));
    }

    if (object.hasOwnProperty('PeakTrainingEffect') && object.PeakTrainingEffect !== null) {
      stats.push(new DataPeakTrainingEffect(object.PeakTrainingEffect));
    }
    if (object.hasOwnProperty('RecoveryTime') && object.RecoveryTime !== null) {
      stats.push(new DataRecovery(object.RecoveryTime));
    }
    if (object.hasOwnProperty('MAXVO2') && object.MAXVO2 !== null) {
      stats.push(new DataVO2Max(object.MAXVO2));
    }

    let pauseDuration = 0;
    if (object.hasOwnProperty('PauseDuration') && object.PauseDuration !== null) {
      pauseDuration = object.PauseDuration;
    }
    stats.push(new DataPause(pauseDuration));
    stats.push(new DataDuration(object.Duration));

    // double case
    if (Array.isArray(object.Altitude)) {
      if (object.Altitude[0].Avg !== null) {
        stats.push(new DataAltitudeAvg(object.Altitude[0].Avg));
      }
      if (object.Altitude[0].Max !== null) {
        stats.push(new DataAltitudeMax(object.Altitude[0].Max));
      }
      if (object.Altitude[0].Min !== null) {
        stats.push(new DataAltitudeMin(object.Altitude[0].Min));
      }
    } else if (object.Altitude) {
      if (object.Altitude.Max !== null) {
        stats.push(new DataAltitudeMax(object.Altitude.Max));
      }
      if (object.Altitude.Min !== null) {
        stats.push(new DataAltitudeMin(object.Altitude.Min));
      }
    }

    if (object.HR) {
      if (object.HR[0].Avg !== null) {
        stats.push(new DataHeartRateAvg(object.HR[0].Avg * 60));
      }
      if (object.HR[0].Max !== null) {
        stats.push(new DataHeartRateMax(object.HR[0].Max * 60));
      }
      if (object.HR[0].Min !== null) {
        stats.push(new DataHeartRateMin(object.HR[0].Min * 60));
      }
    }

    if (object.Cadence) {
      if (object.Cadence[0].Avg !== null) {
        stats.push(new DataCadenceAvg(object.Cadence[0].Avg * 60 * 2));
      }
      if (object.Cadence[0].Max !== null) {
        stats.push(new DataCadenceMax(object.Cadence[0].Max * 60 * 2));
      }
      if (object.Cadence[0].Min !== null) {
        stats.push(new DataCadenceMin(object.Cadence[0].Min * 60 * 2));
      }
    }

    if (object.Power) {
      if (object.Power[0].Avg !== null) {
        stats.push(new DataPowerAvg(object.Power[0].Avg));
      }
      if (object.Power[0].Max !== null) {
        stats.push(new DataPowerMax(object.Power[0].Max));
      }
      if (object.Power[0].Min !== null) {
        stats.push(new DataPowerMin(object.Power[0].Min));
      }
    }

    if (object.Speed) {
      if (object.Speed[0].Avg !== null) {
        stats.push(new DataSpeedAvg(object.Speed[0].Avg));
      }
      if (object.Speed[0].Max !== null) {
        stats.push(new DataSpeedMax(object.Speed[0].Max));
      }
      if (object.Speed[0].Min !== null) {
        stats.push(new DataSpeedMin(object.Speed[0].Min));
      }
    }

    if (object.Temperature) {
      if (object.Temperature[0].Avg !== null) {
        stats.push(new DataTemperatureAvg(object.Temperature[0].Avg - 273.15));
      }
      if (object.Temperature[0].Max !== null) {
        stats.push(new DataTemperatureMax(object.Temperature[0].Max - 273.15));
      }
      if (object.Temperature[0].Min !== null) {
        stats.push(new DataTemperatureMin(object.Temperature[0].Min - 273.15));
      }
    }

    if (object.hasOwnProperty('VerticalSpeed')) {
      // Double action here
      if (Array.isArray(object.VerticalSpeed)) {
        if (object.VerticalSpeed[0].Avg !== null) {
          stats.push(new DataVerticalSpeedAvg(object.VerticalSpeed[0].Avg));
        }
        if (object.VerticalSpeed[0].Max !== null) {
          stats.push(new DataVerticalSpeedMax(object.VerticalSpeed[0].Max));
        }
        if (object.VerticalSpeed[0].Min !== null) {
          stats.push(new DataVerticalSpeedMin(object.VerticalSpeed[0].Min));
        }
      } else {
        if (object.VerticalSpeed !== null) {
          stats.push(new DataVerticalSpeedAvg(object.VerticalSpeed));
        }
      }
    }
    return stats;
  }
}
