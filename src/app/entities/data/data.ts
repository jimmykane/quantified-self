import {DataInterface, UnitSystem} from './data.interface';

export abstract class Data implements DataInterface {

  static className: string;
  static type: string;
  static unit: string;
  static unitSystem = UnitSystem.Metric;
  protected value: number;

  constructor(value: string | number) {
    this.setValue(value);
  }

  setValue(value: string | number) {
    if (value === null || value === void 0 || isNaN(Number(value))) {
      // Todo allow strings
      throw new Error('Null, undefined, void 0 or NaN is not a correct value for data. Use a string or number');
    }
    this.value = Number(value);
  }

  getValue(): number {
    return this.value;
  }

  getDisplayValue(): number | string {
    return this.getValue();
  }

  getType(): string {
    return (<typeof Data>this.constructor).type;
  }

  getUnit(): string {
    return (<typeof Data>this.constructor).unit;
  }

  getDisplayUnit(): string {
    return this.getUnit();
  }

  getUnitSystem(): UnitSystem {
    return (<typeof Data>this.constructor).unitSystem;
  }

  getClassName(): string {
    return (<typeof Data>this.constructor).className;
  }

  toJSON(): any {
    return {
      className: this.getClassName(),
      value: this.getValue(),
    };
  }
}
