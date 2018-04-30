import {DataBare} from './data.bare';

export abstract class DataBoolean extends DataBare {
  static className = 'DataBoolean';
  protected value;

  constructor(value: boolean) {
    super(value);
    this.setValue(value);
  }
}
