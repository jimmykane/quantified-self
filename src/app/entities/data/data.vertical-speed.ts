import {DataNumber} from './data.number';

export class DataVerticalSpeed extends DataNumber {
  static className = 'DataVerticalSpeed';
  static type = 'Vertical Speed';
  static unit = 'm/s';

  getDisplayValue() {
    return this.getValue().toFixed(3);
  }
}
