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
    if (!m) {
      return ('0' + s).slice(-2) + 's';
    } else if (!h) {
      return ('0' + m).slice(-2) + 'm ' + ('0' + s).slice(-2) + 's';
    } else {
      return ('0' + h).slice(-2) + 'h ' + ('0' + m).slice(-2) + 'm ' + ('0' + s).slice(-2) + 's';
    }
  }

  getDisplayUnit() {
    return '';
  }
}
