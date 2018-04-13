import {Data} from './data';

export class DataAltitude extends Data {
  static className = 'DataAltitude';
  static type = 'Altitude';
  static unit = 'm';

  getDisplayValue() {
    return Math.round(this.getValue());
  }
}
