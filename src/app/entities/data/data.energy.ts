import {DataNumber} from './data.number';

export class DataEnergy extends DataNumber {
  static className = 'DataEnergy';
  static type = 'Energy';
  static unit = 'KCal';

  getDisplayValue() {
    return Math.round(this.value);
  }
}
