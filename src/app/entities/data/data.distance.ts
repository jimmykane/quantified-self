import {Data} from './data';

export class DataDistance extends Data {
  static className = 'DataDistance';

  static type = 'Distance';
  static unit = 'm';

  getDisplayValue() {
    return this.getValue() >= 1000 ? (this.getValue() / 1000).toFixed(2) : this.getValue();
  }

  getDisplayUnit() {
    return this.getValue() >= 1000 ? 'Km' : 'm';
  }
}
