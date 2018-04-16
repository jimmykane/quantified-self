import {DataNumber} from './data.number';

export class DataTemperature extends DataNumber {
  static className = 'DataTemperature';
  static type = 'Temperature';
  static unit = '°C';

  getDisplayValue() {
    return Math.round(this.getValue());
  }
}
