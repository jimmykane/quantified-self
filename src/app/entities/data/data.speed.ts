import {DataNumber} from './data.number';

export class DataSpeed extends DataNumber {
  static className = 'DataSpeed';
  static type = 'Speed';
  static unit = 'm/s';

  getDisplayValue() {
    return this.getValue().toFixed(3);
  }
}
