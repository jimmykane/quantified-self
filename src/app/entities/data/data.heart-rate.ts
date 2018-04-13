import {Data} from './data';

export class DataHeartRate extends Data {
  static className = 'DataHeartRate';
  static type = 'Heart Rate';
  static unit = 'bpm';

  getDisplayValue(){
    return Math.round(this.getValue());
  }
}
