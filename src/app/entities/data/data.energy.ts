import {Data} from './data';

export class DataEnergy extends Data {
  static className = 'DataEnergy';
  static type = 'Energy';
  static unit = 'KCal';

  getDisplayValue() {
    return Math.round(this.value);
  }
}
