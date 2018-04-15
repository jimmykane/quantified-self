import {DataNumber} from './data.number';

export class DataDuration extends DataNumber {
  static className = 'DataDuration';
  static type = 'Duration';
  static unit = 's';

  getDisplayValue() {
    const d = this.getValue();
    const h = Math.floor(d / 3600);
    const m = Math.floor(d % 3600 / 60);
    const s = Math.floor(d % 3600 % 60);
    return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2);
  }

  getDisplayUnit() {
    return '';
  }
}
