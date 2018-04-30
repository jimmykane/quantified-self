import {DataBare} from './data.bare';

export abstract class DataBoolean extends DataBare {
  static className = 'DataBoolean';
  protected value;

  constructor(value: string | number) {
    super(value);
    this.setValue(Boolean(value));
  }
}
