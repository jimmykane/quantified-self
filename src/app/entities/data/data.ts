import {DataInterface} from './data.interface';
import {PointInterface} from '../points/point.interface';

export abstract class Data implements DataInterface {

  static type: string;
  static unit: string;
  private value: number;

  constructor(value: string | number) {
    this.setValue(value);
  }

  setValue(value: string | number) {
    this.value = Number(value);
  }

  getValue(): number {
    return this.value;
  }

  getType(): string {
    return (<typeof Data>this.constructor).type;
  }

  getUnit(): string {
    return (<typeof Data>this.constructor).unit;
  }

  toJSON(): any {
    return {
      type: this.getType(),
      value: this.getValue()
    };
  }
}
