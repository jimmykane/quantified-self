import {DataAltitude} from './data.altitude';

export class DataGPSAltitude extends DataAltitude {
  protected type = 'Altitude GPS';
  protected unit = 'meters';
}
