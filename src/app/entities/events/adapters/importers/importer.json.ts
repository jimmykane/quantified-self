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
import {Zones} from "../../../intensity-zones/intensity-zone";

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
      lap.setType(lapObject.type);
      const lapSummary = new Summary();
      lapSummary.setTotalDistanceInMeters(lapObject.summary.totalDistanceInMeters);
      lapSummary.setTotalDurationInSeconds(lapObject.summary.totalDurationInSeconds);
      lapSummary.setMaxAltitudeInMeters(lapObject.summary.maxAltitudeInMeters);
      lapSummary.setMinAltitudeInMeters(lapObject.summary.minAltitudeInMeters);
      lapSummary.setAscentTimeInSeconds(lapObject.summary.ascentTimeInSeconds);
      lapSummary.setDescentTimeInSeconds(lapObject.summary.descentTimeInSeconds);
      lapSummary.setAscentInMeters(lapObject.summary.ascentInMeters);
      lapSummary.setDescentInMeters(lapObject.summary.descentInMeters);
      lapSummary.setEPOC(lapObject.summary.epoc);
      lapSummary.setEnergyInCal(lapObject.summary.energyInCal);
      lapSummary.setFeeling(lapObject.summary.feeling);
      lapSummary.setPeakTrainingEffect(lapObject.summary.peakTrainingEffect);
      lapSummary.setPauseDurationInSeconds(lapObject.summary.pauseDurationInSeconds);
      lapSummary.setRecoveryTimeInSeconds(lapObject.summary.recoveryTimeInSeconds);
      lapSummary.setMaxVO2(lapObject.summary.maxVO2);
      lapSummary.setAvgHR(lapObject.summary.avgHR);
      lapSummary.setMaxHR(lapObject.summary.maxHR);
      lapSummary.setMinHR(lapObject.summary.minHR);
      lapSummary.setMinHR(lapObject.summary.minHR);
      lapSummary.setMinPower(lapObject.summary.minPower);
      lapSummary.setAvgPower(lapObject.summary.avgPower);
      lapSummary.setMaxPower(lapObject.summary.maxPower);
      lapSummary.setMinCadence(lapObject.summary.minCadence);
      lapSummary.setMaxCadence(lapObject.summary.maxCadence);
      lapSummary.setAvgCadence(lapObject.summary.avgCadence);
      lapSummary.setMaxSpeed(lapObject.summary.maxSpeed);
      lapSummary.setMinSpeed(lapObject.summary.minSpeed);
      lapSummary.setAvgSpeed(lapObject.summary.avgSpeed);
      lapSummary.setMinVerticalSpeed(lapObject.summary.minVerticalSpeed);
      lapSummary.setMaxVerticalSpeed(lapObject.summary.maxVerticalSpeed);
      lapSummary.setAvgVerticalSpeed(lapObject.summary.avgVerticalSpeed);
      lapSummary.setMinTemperature(lapObject.summary.minTemperature);
      lapSummary.setMaxTemperature(lapObject.summary.maxTemperature);
      lapSummary.setAvgTemperature(lapObject.summary.avgTemperature);
      lap.setSummary(lapSummary);
      event.addLap(lap);
    }

    for (const activityObject of eventJSONObject.activities) {
      const activity = new Activity();
      activity.setStartDate(new Date(activityObject.startDate));
      activity.setEndDate(new Date(activityObject.endDate));
      activity.setType(activityObject.type);
      const activitySummary = new Summary();
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
      activitySummary.setMaxVO2(activityObject.summary.maxVO2);
      activitySummary.setAvgHR(activityObject.summary.avgHR);
      activitySummary.setMaxHR(activityObject.summary.maxHR);
      activitySummary.setMinHR(activityObject.summary.minHR);
      activitySummary.setMinPower(activityObject.summary.minPower);
      activitySummary.setAvgPower(activityObject.summary.avgPower);
      activitySummary.setMaxPower(activityObject.summary.maxPower);
      activitySummary.setMinCadence(activityObject.summary.minCadence);
      activitySummary.setMaxCadence(activityObject.summary.maxCadence);
      activitySummary.setAvgCadence(activityObject.summary.avgCadence);
      activitySummary.setMaxSpeed(activityObject.summary.maxSpeed);
      activitySummary.setMinSpeed(activityObject.summary.minSpeed);
      activitySummary.setAvgSpeed(activityObject.summary.avgSpeed);
      activitySummary.setMinVerticalSpeed(activityObject.summary.minVerticalSpeed);
      activitySummary.setMaxVerticalSpeed(activityObject.summary.maxVerticalSpeed);
      activitySummary.setAvgVerticalSpeed(activityObject.summary.avgVerticalSpeed);
      activitySummary.setMinTemperature(activityObject.summary.minTemperature);
      activitySummary.setMaxTemperature(activityObject.summary.maxTemperature);
      activitySummary.setAvgTemperature(activityObject.summary.avgTemperature);


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

      if (activityObject.summary.intensityZones) {
        activityObject.summary.intensityZones.forEach((value, key) => {
          const zones = new Zones();
          zones.zone1Duration = value.Zone1Duration;
          zones.zone2Duration = value.Zone2Duration;
          zones.zone2LowerLimit = value.Zone2LowerLimit;
          zones.zone3Duration = value.Zone3Duration;
          zones.zone3LowerLimit = value.Zone3LowerLimit;
          zones.zone4Duration = value.Zone4Duration;
          zones.zone4LowerLimit = value.Zone4LowerLimit;
          zones.zone5Duration = value.Zone5Duration;
          zones.zone5LowerLimit = value.Zone5LowerLimit;
          activitySummary.addIntensityZone(key, zones);
        });
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
