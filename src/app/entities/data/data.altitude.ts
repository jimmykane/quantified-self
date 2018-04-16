import {DataNumber} from './data.number';

export class DataAltitude extends DataNumber {
  static className = 'DataAltitude';
  static type = 'Altitude';
  static unit = 'm';

  getDisplayValue() {
    return Math.round(this.getValue());
  }
}
