import {Data} from './data';

export class DataVerticalSpeed extends Data {
  static className = 'DataVerticalSpeed';
  static type = 'Vertical Speed';
  static unit = 'm/s';

  getDisplayValue(){
    return this.getValue().toFixed(3);
  }
}
