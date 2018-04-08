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
import {SummaryInterface} from "../../../summary/summary.interface";

export class EventImporterJSON {

  static getFromJSONString(jsonString: string, id?: string): EventInterface {
    const eventJSONObject = JSON.parse(jsonString);
    const event = new Event();
    event.setID(eventJSONObject.id);
    event.name = eventJSONObject.name;
    event.summary = this.getSummary(eventJSONObject);

    for (const activityObject of eventJSONObject.activities) {
      const activity = new Activity();
      activity.setID(activityObject.id);
      activity.startDate = new Date(activityObject.startDate);
      activity.endDate = new Date(activityObject.endDate);
      activity.type = activityObject.type;

      activity.summary = this.getSummary(activityObject);
      activity.ibiData = new IBIData(activityObject.ibiData);

      for (const lapObject of activityObject.laps) {
        const lap = new Lap(new Date(lapObject.startDate), new Date(lapObject.endDate));
        lap.type = lapObject.type;
        lap.summary = this.getSummary(lapObject);
        activity.addLap(lap);
      }

      event.addActivity(activity);

      const creator = new Creator();
      creator.name = activityObject.creator.name;
      creator.hwInfo = activityObject.creator.hwInfo;
      creator.swInfo = activityObject.creator.swInfo;
      creator.serialNumber = activityObject.creator.serialNumber;
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

  private static getSummary(object: any): SummaryInterface {
    const summary = new Summary();
    summary.totalDistanceInMeters = object.summary.totalDistanceInMeters;
    summary.totalDurationInSeconds = object.summary.totalDurationInSeconds;
    summary.maxAltitudeInMeters = object.summary.maxAltitudeInMeters;
    summary.minAltitudeInMeters = object.summary.minAltitudeInMeters;
    summary.ascentTimeInSeconds = object.summary.ascentTimeInSeconds;
    summary.descentTimeInSeconds = object.summary.descentTimeInSeconds;
    summary.ascentInMeters = object.summary.ascentInMeters;
    summary.descentInMeters = object.summary.descentInMeters;
    summary.epoc = object.summary.epoc;
    summary.energyInCal = object.summary.energyInCal;
    summary.feeling = object.summary.feeling;
    summary.peakTrainingEffect = object.summary.peakTrainingEffect;
    summary.pauseDurationInSeconds = object.summary.pauseDurationInSeconds;
    summary.recoveryTimeInSeconds = object.summary.recoveryTimeInSeconds;
    summary.maxVO2 = object.summary.maxVO2;
    summary.avgHR = object.summary.avgHR;
    summary.maxHR = object.summary.maxHR;
    summary.minHR = object.summary.minHR;
    summary.minPower = object.summary.minPower;
    summary.avgPower = object.summary.avgPower;
    summary.maxPower = object.summary.maxPower;
    summary.minCadence = object.summary.minCadence;
    summary.maxCadence = object.summary.maxCadence;
    summary.avgCadence = object.summary.avgCadence;
    summary.maxSpeed = object.summary.maxSpeed;
    summary.minSpeed = object.summary.minSpeed;
    summary.avgSpeed = object.summary.avgSpeed;
    summary.minVerticalSpeed = object.summary.minVerticalSpeed;
    summary.maxVerticalSpeed = object.summary.maxVerticalSpeed;
    summary.avgVerticalSpeed = object.summary.avgVerticalSpeed;
    summary.minTemperature = object.summary.minTemperature;
    summary.maxTemperature = object.summary.maxTemperature;
    summary.avgTemperature = object.summary.avgTemperature;

    if (object.summary.weather) {
      const weatherItems = [];
      for (const weatherItemObject of object.summary.weather.weatherItems) {
        weatherItems.push(
          new WeatherItem(
            new Date(weatherItemObject.date),
            weatherItemObject.conditions,
            weatherItemObject.temperatureInCelsius
          )
        )
      }
      summary.weather = new Weather(weatherItems);
    }

    if (object.summary.geoLocationInfo) {
      summary.geoLocationInfo = new GeoLocationInfo(
        object.summary.geoLocationInfo.latitude,
        object.summary.geoLocationInfo.longitude
      );
      summary.geoLocationInfo.city = object.summary.geoLocationInfo.city;
      summary.geoLocationInfo.country = object.summary.geoLocationInfo.country;
      summary.geoLocationInfo.province = object.summary.geoLocationInfo.province;
    }

    if (object.summary.intensityZones) {
      for (const key in object.summary.intensityZones) {
        const zones = new IntensityZones();
        zones.zone1Duration = object.summary.intensityZones[key].zone1Duration;
        zones.zone2Duration = object.summary.intensityZones[key].zone2Duration;
        zones.zone2LowerLimit = object.summary.intensityZones[key].zone2LowerLimit;
        zones.zone3Duration = object.summary.intensityZones[key].zone3Duration;
        zones.zone3LowerLimit = object.summary.intensityZones[key].zone3LowerLimit;
        zones.zone4Duration = object.summary.intensityZones[key].zone4Duration;
        zones.zone4LowerLimit = object.summary.intensityZones[key].zone4LowerLimit;
        zones.zone5Duration = object.summary.intensityZones[key].zone5Duration;
        zones.zone5LowerLimit = object.summary.intensityZones[key].zone5LowerLimit;
        summary.intensityZones.set(key, zones);
      }
    }

    return summary;
  }
}
