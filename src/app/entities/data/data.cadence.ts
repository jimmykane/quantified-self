import {Data} from './data';

export class DataCadence extends Data {
  static className = 'DataCadence';
  static type = 'Cadence';
  static unit = 'spm';

  getDisplayValue() {
    return Math.round(this.getValue());
  }
}
