import {DataDistance} from './data.distance';
import {Data} from './data';

export class DataAscent extends DataDistance {
  static className = 'DataAscent';
  static type = 'Ascent';

  getDisplayValue() {
    return this.value;
  }

  getDisplayUnit(): string {
    return (<typeof Data>this.constructor).unit;
  }
}
