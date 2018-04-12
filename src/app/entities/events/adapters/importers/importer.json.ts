import {Event} from '../../event';
import {Activity} from '../../../activities/activity';
import {Lap} from '../../../laps/lap';
import {Point} from '../../../points/point';
import {EventInterface} from '../../event.interface';
import {Creator} from '../../../creators/creator';
import {WeatherItem} from '../../../weather/app.weather.item';
import {Weather} from '../../../weather/app.weather';
import {GeoLocationInfo} from '../../../geo-location-info/geo-location-info';
import {Summary} from '../../../summary/summary';
import {IntensityZones} from '../../../intensity-zones/intensity-zone';
import {IBIData} from '../../../data/ibi/data.ibi';
import {SummaryInterface} from '../../../summary/summary.interface';
import {DynamicDataLoader} from '../../../data/data.store';

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

      if (activityObject.intensityZones) {
        for (const key in activityObject.intensityZones) {
          const zones = new IntensityZones();
          zones.zone1Duration = activityObject.intensityZones[key].zone1Duration;
          zones.zone2Duration = activityObject.intensityZones[key].zone2Duration;
          zones.zone2LowerLimit = activityObject.intensityZones[key].zone2LowerLimit;
          zones.zone3Duration = activityObject.intensityZones[key].zone3Duration;
          zones.zone3LowerLimit = activityObject.intensityZones[key].zone3LowerLimit;
          zones.zone4Duration = activityObject.intensityZones[key].zone4Duration;
          zones.zone4LowerLimit = activityObject.intensityZones[key].zone4LowerLimit;
          zones.zone5Duration = activityObject.intensityZones[key].zone5Duration;
          zones.zone5LowerLimit = activityObject.intensityZones[key].zone5LowerLimit;
          activity.intensityZones.set(key, zones);
        }
      }

      for (const pointObject of activityObject.points) {
        const point = new Point(new Date(pointObject.date));
        activity.addPoint(point);
        for (const dataObject of pointObject.data) {
          point.addData(DynamicDataLoader.createData(dataObject.className, dataObject.value));
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

    return summary;
  }
}
