import {Event} from '../../../event';
import {Activity} from '../../../../activities/activity';
import {Lap} from '../../../../laps/lap';
import {Point} from '../../../../points/point';
import {DataAltitude} from '../../../../data/data.altitude';
import {DataCadence} from '../../../../data/data.cadence';
import {DataHeartRate} from '../../../../data/data.heart-rate';
import {DataSpeed} from '../../../../data/data.speed';
import {EventInterface} from '../../../event.interface';
import {DataLatitudeDegrees} from '../../../../data/data.latitude-degrees';
import {DataLongitudeDegrees} from '../../../../data/data.longitude-degrees';
import {DataTemperature} from '../../../../data/data.temperature';
import {Creator} from '../../../../creators/creator';
import EasyFit from 'easy-fit';
import {CreatorInterface} from '../../../../creators/creatorInterface';

export class EventImporterFIT {

  static getFromArrayBuffer(jsonString: string, id?: string): Promise<EventInterface> {
    return new Promise((resolve, reject) => {

      const easyFitParser = new EasyFit({
        force: false,
        speedUnit: 'km/h',
        lengthUnit: 'm',
        temperatureUnit: 'celsius',
        elapsedRecordField: false,
        mode: 'cascade',
      });

      easyFitParser.parse(jsonString, (error, data: any) => {
        debugger;
        // Create an event
        const event = new Event();
        // Create an activity
        const activity = new Activity();
        // Get and set the creator to the activity
        activity.creator = this.getCreator(data);
        resolve(event);
      });

    });
  }

  private static getCreator(data: any): CreatorInterface {
    const creator = new Creator();
    creator.hwInfo = data.file_creator.hardware_version;
    creator.swInfo = data.file_creator.software_version;

    // Set the name
    if (data.file_id.manufacturer !== 'suunto'){
      creator.name = data.file_id.product;
      return creator;
    }

    // If it's a suunto fit
    switch (data.file_id.product) {
      case 34: {
        creator.name = 'Suunto 9';
        break;
      }
      case 29: {
        creator.name = 'Suunto Spartan Ultra';
        break;
      }
    }
    return creator;
  }
}
