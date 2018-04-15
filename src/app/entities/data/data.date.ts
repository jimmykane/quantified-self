import {Data} from './data';

export abstract class DataDate extends Data {
  static className = 'DateDate';

  getValue(): Date {
    return <Date>this.value;
  }
}
