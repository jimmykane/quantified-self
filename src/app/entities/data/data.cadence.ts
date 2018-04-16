import {DataNumber} from './data.number';

export class DataCadence extends DataNumber {
  static className = 'DataCadence';
  static type = 'Cadence';
  static unit = 'spm';

  getDisplayValue() {
    return Math.round(this.getValue());
  }
}
