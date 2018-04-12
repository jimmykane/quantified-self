import {Data} from './data';

export abstract class DataBare extends Data {
  static className = 'DataBare';
  static unit = ''; // Bare data have no unit
}
