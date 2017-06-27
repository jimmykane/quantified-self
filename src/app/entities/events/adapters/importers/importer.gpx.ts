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
import {DataPower} from "../../../data/data.power";

export class EventImporterGPX {
  static getFromXML(xml: Document, id?: string): EventInterface {
    const event = new Event();
    event.setID(id || event.getID());

    // Create an activity
    const activity = new Activity(event);
    activity.setID(xml.getElementsByTagName('name')[0].textContent);

    // Create a creator
    const creator = new Creator(activity);
    creator.setName(xml.getElementsByTagName('gpx')[0].getAttribute('creator'));
    for (const lapElement of <any>xml.getElementsByTagNameNS('http://www.cluetrust.com/XML/GPXDATA/1/0', 'lap')) {
      // If the lap does not have any elapsed time or distance dont add it
      if (Number(
          lapElement.getElementsByTagNameNS('http://www.cluetrust.com/XML/GPXDATA/1/0', 'elapsedTime')[0].textContent
        ) === 0) {
        continue;
      }
      const lap = new Lap(event);
      lap.setStartDate(new Date(lapElement.getElementsByTagNameNS('http://www.cluetrust.com/XML/GPXDATA/1/0', 'startTime')[0].textContent));
      lap.setEndDate(
        new Date(
          lap.getStartDate().getTime() + 1000 *
          Number(lapElement.getElementsByTagNameNS('http://www.cluetrust.com/XML/GPXDATA/1/0', 'elapsedTime')[0].textContent)
        )
      );
    }

    // Get the points
    for (const pointElement of <any>xml.getElementsByTagName('trkpt')) {
      const point = new Point(new Date(pointElement.getElementsByTagName('time')[0].textContent));
      point.setActivity(activity);
      new DataLatitudeDegrees(point, pointElement.getAttribute('lat'));
      new DataLongitudeDegrees(point, pointElement.getAttribute('lon'));
      // Go over the extensions
      if (pointElement.getElementsByTagName('extensions')[0]) {
        for (const dataElement of <any>pointElement.getElementsByTagName('extensions')[0].children) {
          switch (dataElement.tagName) {
            case 'gpxdata:altitude': {
              new DataAltitude(point, dataElement.textContent);
              break;
            }
            case 'gpxdata:cadence': {
              new DataCadence(point, dataElement.textContent);
              break;
            }
            case 'gpxdata:temp': {
              new DataTemperature(point, dataElement.textContent);
              break;
            }
            case 'gpxdata:seaLevelPressure': {
              new DataSeaLevelPressure(point, dataElement.textContent);
              break;
            }
            case 'gpxdata:speed': {
              new DataSpeed(point, dataElement.textContent);
              break;
            }
            case 'gpxdata:verticalSpeed': {
              new DataVerticalSpeed(point, dataElement.textContent);
              break;
            }
            case 'gpxdata:power': {
              new DataPower(point, dataElement.textContent);
              break;
            }
            case 'gpxtpx:TrackPointExtension': {
              for (const dataExtensionElement of <any>dataElement.children) {
                switch (dataExtensionElement.tagName) {
                  case 'gpxtpx:hr': {
                    new DataHeartRate(point, dataElement.textContent);
                    break;
                  }
                }
              }
            }
          }
        }
      }
    }
    return event;
  }
}
