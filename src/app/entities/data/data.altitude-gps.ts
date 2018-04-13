import {DataAltitude} from './data.altitude';

export class DataGPSAltitude extends DataAltitude {
  static className = 'DataGPSAltitude';
  static type = 'Altitude GPS';
  static unit = 'm';
}
