import {DataNumber} from './data.number';

export class DataDistance extends DataNumber {
  static className = 'DataDistance';

  static type = 'Distance';
  static unit = 'm';

  getDisplayValue() {
    return this.getValue() >= 1000 ? (this.getValue() / 1000).toFixed(2) : this.getValue().toFixed(1);
  }

  getDisplayUnit() {
    return this.getValue() >= 1000 ? 'Km' : 'm';
  }
}
