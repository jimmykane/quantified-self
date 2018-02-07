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
import {WeatherItem} from "../../../weather/app.weather.item";
import {Weather} from "../../../weather/app.weather";
import {EventSummary} from "../../summary/event.summary";
import {GeoLocationInfo} from "../../../geo-location-info/app.geo-location-info";

export class EventImporterJSON {

  static getFromJSONString(jsonString: string, id?: string): EventInterface {
    const eventJSONObject = JSON.parse(jsonString);
    const event = new Event();
    event.setID(eventJSONObject.id);
    event.setName(eventJSONObject.name);
    event.setSummary(new EventSummary());

    const weatherItems = [];
    for (const weatherItemObject of eventJSONObject.summary.weather.weatherItems) {
      weatherItems.push(
        new WeatherItem(
          new Date(weatherItemObject.date),
          weatherItemObject.conditions,
          weatherItemObject.temperatureInCelsius
        )
      )
    }

    event.getSummary().setWeather(new Weather(weatherItems));
    event.getSummary().setTotalDistanceInMeters(eventJSONObject.summary.distanceInMeters);
    event.getSummary().setTotalDurationInSeconds(eventJSONObject.summary.totalDurationInSeconds);

    event.getSummary().setGeoLocationInfo(
      new GeoLocationInfo(
        eventJSONObject.summary.geoLocationInfo.latitude,
        eventJSONObject.summary.geoLocationInfo.longitude
      )
    );
    event.getSummary().getGeoLocationInfo().city = eventJSONObject.summary.geoLocationInfo.city;
    event.getSummary().getGeoLocationInfo().country = eventJSONObject.summary.geoLocationInfo.country;
    event.getSummary().getGeoLocationInfo().province = eventJSONObject.summary.geoLocationInfo.province;

    for (const lapObject of eventJSONObject.laps) {
      const lap = new Lap(new Date(lapObject.startDate), new Date(lapObject.endDate));
      lap.setCalories(lapObject.calories);
      lap.setIntensity(lapObject.intensity);
      lap.setTriggerMethod(lapObject.triggerMethod);
      event.addLap(lap);
    }

    for (const activityObject of eventJSONObject.activities) {
      const activity = new Activity();
      activity.setType(activityObject.type);
      event.addActivity(activity);
      for (const creatorObject of activityObject.creators) {
        const creator = new Creator(activity);
        creator.setName(creatorObject.name);
      }

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
