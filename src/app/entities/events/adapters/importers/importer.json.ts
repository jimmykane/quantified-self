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
import {DataRespirationRate} from '../../../data/data.respiration-rate';
import {DataEHPE} from '../../../data/data.ehpe';
import {DataAbsolutePressure} from '../../../data/data.absolute-pressure';
import {DataGPSAltitude} from '../../../data/data.gps-altitude';
import {WeatherItem} from '../../../weather/app.weather.item';
import {Weather} from '../../../weather/app.weather';
import {GeoLocationInfo} from '../../../geo-location-info/app.geo-location-info';
import {Summary} from '../../../summary/summary';
import {DataEVPE} from '../../../data/data.evpe';
import {DataSatellite5BestSNR} from '../../../data/data.satellite-5-best-snr';
import {DataNumberOfSatellites} from '../../../data/data.number-of-satellites';
import {ActivitySummary} from '../../../activities/activity.summary';

export class EventImporterJSON {

  static getFromJSONString(jsonString: string, id?: string): EventInterface {
    const eventJSONObject = JSON.parse(jsonString);
    const event = new Event();
    event.setID(eventJSONObject.id);
    event.setName(eventJSONObject.name);
    event.setSummary(new Summary());

    event.getSummary().setTotalDistanceInMeters(eventJSONObject.summary.totalDistanceInMeters);
    event.getSummary().setTotalDurationInSeconds(eventJSONObject.summary.totalDurationInSeconds);

    for (const lapObject of eventJSONObject.laps) {
      const lap = new Lap(new Date(lapObject.startDate), new Date(lapObject.endDate));
      lap.setCalories(lapObject.calories);
      lap.setIntensity(lapObject.intensity);
      lap.setTriggerMethod(lapObject.triggerMethod);
      const lapSummary = new Summary();
      lapSummary.setTotalDistanceInMeters(lapObject.summary.totalDistanceInMeters);
      lapSummary.setTotalDurationInSeconds(lapObject.summary.totalDurationInSeconds);
      lap.setSummary(lapSummary);
      event.addLap(lap);
    }

    for (const activityObject of eventJSONObject.activities) {
      const activity = new Activity();
      activity.setType(activityObject.type);
      const activitySummary = new ActivitySummary();
      activitySummary.setTotalDistanceInMeters(activityObject.summary.totalDistanceInMeters);
      activitySummary.setTotalDurationInSeconds(activityObject.summary.totalDurationInSeconds);
      activitySummary.setMaxAltitudeInMeters(activityObject.summary.maxAltitudeInMeters);
      activitySummary.setMinAltitudeInMeters(activityObject.summary.minAltitudeInMeters);
      activitySummary.setAscentTimeInSeconds(activityObject.summary.ascentTimeInSeconds);
      activitySummary.setDescentTimeInSeconds(activityObject.summary.descentTimeInSeconds);
      activitySummary.setAscentInMeters(activityObject.summary.ascentInMeters);
      activitySummary.setDescentInMeters(activityObject.summary.descentInMeters);
      activitySummary.setEPOC(activityObject.summary.epoc);
      activitySummary.setEnergyInCal(activityObject.summary.energyInCal);
      activitySummary.setFeeling(activityObject.summary.feeling);
      activitySummary.setPeakTrainingEffect(activityObject.summary.peakTrainingEffect);
      activitySummary.setPauseDurationInSeconds(activityObject.summary.pauseDurationInSeconds);
      activitySummary.setRecoveryTimeInSeconds(activityObject.summary.recoveryTimeInSeconds);

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
        activitySummary.setWeather(new Weather(weatherItems));
      }

      if (activityObject.summary.geoLocationInfo) {
        activitySummary.setGeoLocationInfo(
          new GeoLocationInfo(
            activityObject.summary.geoLocationInfo.latitude,
            activityObject.summary.geoLocationInfo.longitude
          )
        );
        activitySummary.getGeoLocationInfo().city = activityObject.summary.geoLocationInfo.city;
        activitySummary.getGeoLocationInfo().country = activityObject.summary.geoLocationInfo.country;
        activitySummary.getGeoLocationInfo().province = activityObject.summary.geoLocationInfo.province;
      }

      activity.setSummary(activitySummary);
      event.addActivity(activity);

      const creator = new Creator();
      creator.setName(activityObject.creator.name);
      creator.setHWInfo(activityObject.creator.hwInfo);
      creator.setSWInfo(activityObject.creator.swInfo);
      creator.setSerialNumber(activityObject.creator.serialNumber);
      activity.setCreator(creator);

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
            case DataRespirationRate.type: {
              point.addData(new DataRespirationRate(dataObject.value));
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
