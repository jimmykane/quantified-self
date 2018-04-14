import {Data} from './data';

export class DataDistance extends Data {
  static className = 'DataDistance';

  static type = 'Distance';
  static unit = 'm';

  getDisplayValue() {
    // @todo convert to KM etc
    return this.getValue().toFixed(2);
  }
}
