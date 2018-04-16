import {DataBare} from './data.bare';

export abstract class DataNumber extends DataBare {
  static className = 'DataNumber';
  protected value;

  constructor(value: string | number) {
    super(value);
    this.setValue(Number(value));
  }

  getValue(): number {
    return this.value;
  }
}
