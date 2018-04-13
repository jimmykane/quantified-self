import {Data} from './data';

export class DataSpeed extends Data {
  static className = 'DataSpeed';
  static type = 'Speed';
  static unit = 'm/s';

  getDisplayValue(){
    return this.getValue().toFixed(3);
  }
}
