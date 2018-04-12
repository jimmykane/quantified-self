import {DataVerticalSpeed} from './data.verticalspeed';
import {DataTemperature} from './data.temperature';
import {DataSpeed} from './data.speed';
import {DataSeaLevelPressure} from './data.sea-level-pressure';
import {DataSatellite5BestSNR} from './data.satellite-5-best-snr';
import {DataAbsolutePressure} from './data.absolute-pressure';
import {DataAltitude} from './data.altitude';
import {DataCadence} from './data.cadence';
import {DataDistance} from './data.distance';
import {DataDuration} from './data.duration';
import {DataEHPE} from './data.ehpe';
import {DataEVPE} from './data.evpe';
import {DataHeartRate} from './data.heart-rate';
import {DataLatitudeDegrees} from './data.latitude-degrees';
import {DataLongitudeDegrees} from './data.longitude-degrees';
import {DataNumberOfSatellites} from './data.number-of-satellites';
import {DataPower} from './data.power';
import {DataGPSAltitude} from './data.altitude-gps';
import {DataInterface} from './data.interface';

export const DataStore: any = {
  DataVerticalSpeed,
  DataTemperature,
  DataSpeed,
  DataSeaLevelPressure,
  DataSatellite5BestSNR,
  DataPower,
  DataNumberOfSatellites,
  DataLongitudeDegrees,
  DataLatitudeDegrees,
  DataHeartRate,
  DataEVPE,
  DataEHPE,
  DataDuration,
  DataDistance,
  DataCadence,
  DataGPSAltitude,
  DataAltitude,
  DataAbsolutePressure,
};

export class DynamicDataLoader {
  static createData(className: string, opts: any): DataInterface {
    if (DataStore[className] === undefined || DataStore[className] === null) {
      throw new Error(`Class type of \'${className}\' is not in the store`);
    }
    return new DataStore[className](opts);
  }
}
