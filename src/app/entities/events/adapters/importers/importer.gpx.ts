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

    // Create an activities
    const activity = new Activity();
    event.addActivity(activity);
    activity.setID(xml.getElementsByTagName('name')[0].textContent);

    // Create a creator
    const creator = new Creator();
    creator.setName(xml.getElementsByTagName('gpx')[0].getAttribute('creator'));
    activity.setCreator(creator);
    for (const lapElement of <any>xml.getElementsByTagNameNS('http://www.cluetrust.com/XML/GPXDATA/1/0', 'lap')) {
      // If the lap does not have any elapsed time or distance dont add it
      if (Math.round(Number(
          lapElement.getElementsByTagNameNS('http://www.cluetrust.com/XML/GPXDATA/1/0', 'elapsedTime')[0].textContent
        )) === 0) {
        continue;
      }

      const lap = new Lap(
        new Date(lapElement.getElementsByTagNameNS('http://www.cluetrust.com/XML/GPXDATA/1/0', 'startTime')[0].textContent),
        new Date(
          +(new Date(lapElement.getElementsByTagNameNS('http://www.cluetrust.com/XML/GPXDATA/1/0', 'startTime')[0].textContent)) +
          1000 * Number(lapElement.getElementsByTagNameNS('http://www.cluetrust.com/XML/GPXDATA/1/0', 'elapsedTime')[0].textContent)
      ));

      event.addLap(lap);
    }

    // Get the points
    for (const pointElement of <any>xml.getElementsByTagName('trkpt')) {
      const point = new Point(new Date(pointElement.getElementsByTagName('time')[0].textContent));
      activity.addPoint(point);
      point.addData(new DataLatitudeDegrees(pointElement.getAttribute('lat')));
      point.addData(new DataLongitudeDegrees(pointElement.getAttribute('lon')));
      if (pointElement.getElementsByTagName('ele')[0]) {
        point.addData(new DataAltitude(pointElement.getElementsByTagName('ele')[0].textContent));
      }
      // Go over the extensions
      if (pointElement.getElementsByTagName('extensions')[0]) {
        for (const dataElement of <any>pointElement.getElementsByTagName('extensions')[0].children) {
          switch (dataElement.tagName) {
            case 'gpxdata:altitude': {
              point.addData(new DataAltitude(dataElement.textContent));
              break;
            }
            case 'gpxdata:cadence': {
              point.addData(new DataCadence(dataElement.textContent));
              break;
            }
            case 'gpxdata:temp': {
              point.addData(new DataTemperature(dataElement.textContent));
              break;
            }
            case 'gpxdata:seaLevelPressure': {
              point.addData(new DataSeaLevelPressure(dataElement.textContent));
              break;
            }
            case 'gpxdata:speed': {
              point.addData(new DataSpeed(dataElement.textContent));
              break;
            }
            case 'gpxdata:verticalSpeed': {
              point.addData(new DataVerticalSpeed(dataElement.textContent));
              break;
            }
            case 'gpxdata:power': {
              point.addData(new DataPower(dataElement.textContent));
              break;
            }
            case 'gpxtpx:TrackPointExtension': {
              for (const dataExtensionElement of <any>dataElement.children) {
                switch (dataExtensionElement.tagName) {
                  case 'gpxtpx:hr': {
                    point.addData(new DataHeartRate(dataExtensionElement.textContent));
                    break;
                  }
                  case 'gpxtpx:cad': {
                    point.addData(new DataCadence(dataExtensionElement.textContent));
                    break;
                  }
                  case 'gpxtpx:atemp': {
                    point.addData(new DataTemperature(dataExtensionElement.textContent));
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
