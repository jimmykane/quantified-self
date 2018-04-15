import {DataInterface, UnitSystem} from './data.interface';

export abstract class Data implements DataInterface {

  static className: string;
  static type: string;
  static unit: string;
  static unitSystem = UnitSystem.Metric;
  protected value: number | string | Date;

  constructor(value: string | number | Date) {
    this.setValue(value);
  }

  setValue(value: string | number | Date) {
    if (value === null || value === void 0) {
      throw new Error('Null, undefined, void 0 or not a date is not a correct value for data. Use a string or number');
    }
    this.value = value;
  }

  getValue(): number | string | Date {
    return this.value;
  }

  getDisplayValue(): number | string | Date {
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
