import {Event} from '../../event';
import {Activity} from '../../../activities/activity';
import {Lap} from '../../../laps/lap';
import {Point} from '../../../points/point';
import {EventInterface} from '../../event.interface';
import {Creator} from '../../../creators/creator';
import {WeatherItem} from '../../../weather/app.weather.item';
import {Weather} from '../../../weather/app.weather';
import {GeoLocationInfo} from '../../../geo-location-info/geo-location-info';
import {IntensityZones} from '../../../intensity-zones/intensity-zone';
import {IBIData} from '../../../data/ibi/data.ibi';
import {DynamicDataLoader} from '../../../data/data.store';

export class EventImporterJSON {

  static getFromJSONString(jsonString: string, id?: string): EventInterface {
    const eventJSONObject = JSON.parse(jsonString);

    const event = new Event();
    event.setID(eventJSONObject.id);
    event.name = eventJSONObject.name;

    eventJSONObject.stats.forEach((stat) => {
      event.addStat(DynamicDataLoader.getDataInstance(stat.className, stat.value))
    });

    for (const activityObject of eventJSONObject.activities) {
      const activity = new Activity();
      activity.setID(activityObject.id);
      activity.startDate = new Date(activityObject.startDate);
      activity.endDate = new Date(activityObject.endDate);
      activity.type = activityObject.type;
      activity.ibiData = new IBIData(activityObject.ibiData);
      if (activityObject.weather) {
        activity.weather = this.getWeather(activityObject);
      }
      if (activityObject.geoLocationInfo) {
        activity.geoLocationInfo = this.getGeoLocationInfo(activityObject);
      }
      activityObject.stats.forEach((stat) => {
        activity.addStat(DynamicDataLoader.getDataInstance(stat.className, stat.value))
      });

      for (const lapObject of activityObject.laps) {
        const lap = new Lap(new Date(lapObject.startDate), new Date(lapObject.endDate));
        lap.type = lapObject.type;
        lap.setID(lapObject.id);
        lapObject.stats.forEach((stat) => {
          lap.addStat(DynamicDataLoader.getDataInstance(stat.className, stat.value))
        });
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
          point.addData(DynamicDataLoader.getDataInstance(dataObject.className, dataObject.value));
        }
      }
    }
    return event;
  }

  private static getGeoLocationInfo(object: any): GeoLocationInfo {
    const geoLocationInfo = new GeoLocationInfo(
      object.geoLocationInfo.latitude,
      object.geoLocationInfo.longitude
    );
    geoLocationInfo.city = object.geoLocationInfo.city;
    geoLocationInfo.country = object.geoLocationInfo.country;
    geoLocationInfo.province = object.geoLocationInfo.province;
    return geoLocationInfo;
  }

  private static getWeather(object: any): Weather {
    const weatherItems = [];
    for (const weatherItemObject of object.weather.weatherItems) {
      weatherItems.push(
        new WeatherItem(
          new Date(weatherItemObject.date),
          weatherItemObject.conditions,
          weatherItemObject.temperatureInCelsius
        )
      )
    }
    return new Weather(weatherItems);
  }
}
