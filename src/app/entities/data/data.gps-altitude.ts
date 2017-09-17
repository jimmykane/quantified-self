import {DataAltitude} from './data.altitude';

export class DataGPSAltitude extends DataAltitude {
  static type = 'Altitude GPS';
  protected unit = 'meters';
}
