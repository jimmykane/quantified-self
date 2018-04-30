import {DataBoolean} from './data.boolean';

export class DataFusedLocation extends DataBoolean {
  static className = 'DataFusedLocation';
  static type = 'Fused Location';
  static unit = '';

  getDisplayValue() {
    return this.getValue() ? 'Yes' : 'No';
  }
}
