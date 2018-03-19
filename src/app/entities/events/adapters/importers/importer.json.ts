import {Event} from '../../event';
import {Activity} from '../../../activities/activity';
import {Lap} from '../../../laps/lap';
import {Point} from '../../../points/point';
import {DataAltitude} from '../../../data/data.altitude';
import {DataCadence} from '../../../data/data.cadence';
import {DataHeartRate} from '../../../data/data.heart-rate';
import {DataSpeed} from '../../../data/data.speed';
import {EventInterface} from '../../event.interface';
import {DataLatitudeDegrees} from '../../../data/data.latitude-degrees';
import {DataLongitudeDegrees} from '../../../data/data.longitude-degrees';
import {DataSeaLevelPressure} from '../../../data/data.sea-level-pressure';
import {DataTemperature} from '../../../data/data.temperature';
import {DataVerticalSpeed} from '../../../data/data.verticalspeed';
import {Creator} from '../../../creators/creator';
import {DataPower} from '../../../data/data.power';
import {DataEHPE} from '../../../data/data.ehpe';
import {DataAbsolutePressure} from '../../../data/data.absolute-pressure';
import {DataGPSAltitude} from '../../../data/data.altitude-gps';
import {WeatherItem} from '../../../weather/app.weather.item';
import {Weather} from '../../../weather/app.weather';
import {GeoLocationInfo} from '../../../geo-location-info/geo-location-info';
import {Summary} from '../../../summary/summary';
import {DataEVPE} from '../../../data/data.evpe';
import {DataSatellite5BestSNR} from '../../../data/data.satellite-5-best-snr';
import {DataNumberOfSatellites} from '../../../data/data.number-of-satellites';
import {IntensityZones} from '../../../intensity-zones/intensity-zone';
import {IBIData} from '../../../data/ibi/data.ibi';

export class EventImporterJSON {

  static getFromJSONString(jsonString: string, id?: string): EventInterface {
    const eventJSONObject = JSON.parse(jsonString);
    const event = new Event();
    event.setID(eventJSONObject.id);
    event.setName(eventJSONObject.name);
    event.setSummary(new Summary());

    event.getSummary().totalDistanceInMeters = eventJSONObject.summary.totalDistanceInMeters;
    event.getSummary().totalDurationInSeconds = eventJSONObject.summary.totalDurationInSeconds;

    for (const activityObject of eventJSONObject.activities) {
      const activity = new Activity();
      activity.startDate = new Date(activityObject.startDate);
      activity.endDate = new Date(activityObject.endDate);
      activity.type = activityObject.type;
      const activitySummary = new Summary();
      activitySummary.totalDistanceInMeters = activityObject.summary.totalDistanceInMeters;
      activitySummary.totalDurationInSeconds = activityObject.summary.totalDurationInSeconds;
      activitySummary.maxAltitudeInMeters = activityObject.summary.maxAltitudeInMeters;
      activitySummary.minAltitudeInMeters = activityObject.summary.minAltitudeInMeters;
      activitySummary.ascentTimeInSeconds = activityObject.summary.ascentTimeInSeconds;
      activitySummary.descentTimeInSeconds = activityObject.summary.descentTimeInSeconds;
      activitySummary.ascentInMeters = activityObject.summary.ascentInMeters;
      activitySummary.descentInMeters = activityObject.summary.descentInMeters;
      activitySummary.epoc = activityObject.summary.epoc;
      activitySummary.energyInCal = activityObject.summary.energyInCal;
      activitySummary.feeling = activityObject.summary.feeling;
      activitySummary.peakTrainingEffect = activityObject.summary.peakTrainingEffect;
      activitySummary.pauseDurationInSeconds = activityObject.summary.pauseDurationInSeconds;
      activitySummary.recoveryTimeInSeconds = activityObject.summary.recoveryTimeInSeconds;
      activitySummary.maxVO2 = activityObject.summary.maxVO2;
      activitySummary.avgHR = activityObject.summary.avgHR;
      activitySummary.maxHR = activityObject.summary.maxHR;
      activitySummary.minHR = activityObject.summary.minHR;
      activitySummary.minPower = activityObject.summary.minPower;
      activitySummary.avgPower = activityObject.summary.avgPower;
      activitySummary.maxPower = activityObject.summary.maxPower;
      activitySummary.minCadence = activityObject.summary.minCadence;
      activitySummary.maxCadence = activityObject.summary.maxCadence;
      activitySummary.avgCadence = activityObject.summary.avgCadence;
      activitySummary.maxSpeed = activityObject.summary.maxSpeed;
      activitySummary.minSpeed = activityObject.summary.minSpeed;
      activitySummary.avgSpeed = activityObject.summary.avgSpeed;
      activitySummary.minVerticalSpeed = activityObject.summary.minVerticalSpeed;
      activitySummary.maxVerticalSpeed = activityObject.summary.maxVerticalSpeed;
      activitySummary.avgVerticalSpeed = activityObject.summary.avgVerticalSpeed;
      activitySummary.minTemperature = activityObject.summary.minTemperature;
      activitySummary.maxTemperature = activityObject.summary.maxTemperature;
      activitySummary.avgTemperature = activityObject.summary.avgTemperature;

      if (activityObject.summary.weather) {
        const weatherItems = [];
        for (const weatherItemObject of activityObject.summary.weather.weatherItems) {
          weatherItems.push(
            new WeatherItem(
              new Date(weatherItemObject.date),
              weatherItemObject.conditions,
              weatherItemObject.temperatureInCelsius
            )
          )
        }
        activitySummary.weather = new Weather(weatherItems);
      }

      if (activityObject.summary.geoLocationInfo) {
        activitySummary.geoLocationInfo = new GeoLocationInfo(
          activityObject.summary.geoLocationInfo.latitude,
          activityObject.summary.geoLocationInfo.longitude
        );
        activitySummary.geoLocationInfo.city = activityObject.summary.geoLocationInfo.city;
        activitySummary.geoLocationInfo.country = activityObject.summary.geoLocationInfo.country;
        activitySummary.geoLocationInfo.province = activityObject.summary.geoLocationInfo.province;
      }

      if (activityObject.summary.intensityZones) {
        for (const key in activityObject.summary.intensityZones) {
          const zones = new IntensityZones();
          zones.zone1Duration = activityObject.summary.intensityZones[key].zone1Duration;
          zones.zone2Duration = activityObject.summary.intensityZones[key].zone2Duration;
          zones.zone2LowerLimit = activityObject.summary.intensityZones[key].zone2LowerLimit;
          zones.zone3Duration = activityObject.summary.intensityZones[key].zone3Duration;
          zones.zone3LowerLimit = activityObject.summary.intensityZones[key].zone3LowerLimit;
          zones.zone4Duration = activityObject.summary.intensityZones[key].zone4Duration;
          zones.zone4LowerLimit = activityObject.summary.intensityZones[key].zone4LowerLimit;
          zones.zone5Duration = activityObject.summary.intensityZones[key].zone5Duration;
          zones.zone5LowerLimit = activityObject.summary.intensityZones[key].zone5LowerLimit;
          activitySummary.intensityZones.set(key, zones);
        }
      }


      activity.setSummary(activitySummary);
      activity.setIBIData(new IBIData(activityObject.ibiData));

      for (const lapObject of activityObject.laps) {
        const lap = new Lap(new Date(lapObject.startDate), new Date(lapObject.endDate));
        lap.type = lapObject.type;
        const lapSummary = new Summary();
        lapSummary.totalDistanceInMeters = lapObject.summary.totalDistanceInMeters;
        lapSummary.totalDurationInSeconds = lapObject.summary.totalDurationInSeconds;
        lapSummary.maxAltitudeInMeters = lapObject.summary.maxAltitudeInMeters;
        lapSummary.minAltitudeInMeters = lapObject.summary.minAltitudeInMeters;
        lapSummary.ascentTimeInSeconds = lapObject.summary.ascentTimeInSeconds;
        lapSummary.descentTimeInSeconds = lapObject.summary.descentTimeInSeconds;
        lapSummary.ascentInMeters = lapObject.summary.ascentInMeters;
        lapSummary.descentInMeters = lapObject.summary.descentInMeters;
        lapSummary.epoc = lapObject.summary.epoc;
        lapSummary.energyInCal = lapObject.summary.energyInCal;
        lapSummary.feeling = lapObject.summary.feeling;
        lapSummary.peakTrainingEffect = lapObject.summary.peakTrainingEffect;
        lapSummary.pauseDurationInSeconds = lapObject.summary.pauseDurationInSeconds;
        lapSummary.recoveryTimeInSeconds = lapObject.summary.recoveryTimeInSeconds;
        lapSummary.maxVO2 = lapObject.summary.maxVO2;
        lapSummary.avgHR = lapObject.summary.avgHR;
        lapSummary.maxHR = lapObject.summary.maxHR;
        lapSummary.minHR = lapObject.summary.minHR;
        lapSummary.minPower = lapObject.summary.minPower;
        lapSummary.avgPower = lapObject.summary.avgPower;
        lapSummary.maxPower = lapObject.summary.maxPower;
        lapSummary.minCadence = lapObject.summary.minCadence;
        lapSummary.maxCadence  = lapObject.summary.maxCadence;
        lapSummary.avgCadence = lapObject.summary.avgCadence;
        lapSummary.maxSpeed = lapObject.summary.maxSpeed;
        lapSummary.minSpeed = lapObject.summary.minSpeed;
        lapSummary.avgSpeed = lapObject.summary.avgSpeed;
        lapSummary.minVerticalSpeed = lapObject.summary.minVerticalSpeed;
        lapSummary.maxVerticalSpeed = lapObject.summary.maxVerticalSpeed;
        lapSummary.avgVerticalSpeed = lapObject.summary.avgVerticalSpeed;
        lapSummary.minTemperature = lapObject.summary.minTemperature;
        lapSummary.maxTemperature = lapObject.summary.maxTemperature;
        lapSummary.avgTemperature = lapObject.summary.avgTemperature;
        lap.summary = lapSummary;
        activity.addLap(lap);
      }

      event.addActivity(activity);

      const creator = new Creator();
      creator.setName(activityObject.creator.name);
      creator.setHWInfo(activityObject.creator.hwInfo);
      creator.setSWInfo(activityObject.creator.swInfo);
      creator.setSerialNumber(activityObject.creator.serialNumber);
      activity.creator = creator;

      for (const pointObject of activityObject.points) {
        const point = new Point(new Date(pointObject.date));
        activity.addPoint(point);
        for (const dataObject of pointObject.data) {
          // @todo make this dynamic
          switch (dataObject.type) {
            case DataAltitude.type: {
              point.addData(new DataAltitude(dataObject.value));
              break;
            }
            case DataGPSAltitude.type: {
              point.addData(new DataGPSAltitude(dataObject.value));
              break;
            }
            case DataEHPE.type: {
              point.addData(new DataEHPE(dataObject.value));
              break;
            }
            case DataEVPE.type: {
              point.addData(new DataEVPE(dataObject.value));
              break;
            }
            case DataSatellite5BestSNR.type: {
              point.addData(new DataSatellite5BestSNR(dataObject.value));
              break;
            }
            case DataNumberOfSatellites.type: {
              point.addData(new DataNumberOfSatellites(dataObject.value));
              break;
            }
            case DataAbsolutePressure.type: {
              point.addData(new DataAbsolutePressure(dataObject.value));
              break;
            }
            case DataCadence.type: {
              point.addData(new DataCadence(dataObject.value));
              break;
            }
            case DataHeartRate.type: {
              point.addData(new DataHeartRate(dataObject.value));
              break;
            }
            case DataLatitudeDegrees.type: {
              point.addData(new DataLatitudeDegrees(dataObject.value));
              break;
            }
            case DataLongitudeDegrees.type: {
              point.addData(new DataLongitudeDegrees(dataObject.value));
              break;
            }
            case DataSeaLevelPressure.type: {
              point.addData(new DataSeaLevelPressure(dataObject.value));
              break;
            }
            case DataSpeed.type: {
              point.addData(new DataSpeed(dataObject.value));
              break;
            }
            case DataTemperature.type: {
              point.addData(new DataTemperature(dataObject.value));
              break;
            }
            case DataVerticalSpeed.type: {
              point.addData(new DataVerticalSpeed(dataObject.value));
              break;
            }
            case DataPower.type: {
              point.addData(new DataPower(dataObject.value));
              break;
            }
          }
        }
      }
    }
    return event;
  }
}
