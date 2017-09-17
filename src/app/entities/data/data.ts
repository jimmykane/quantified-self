import {DataInterface} from './data.interface';
import {PointInterface} from '../points/point.interface';

export abstract class Data implements DataInterface {

  static type: string;
  private point: PointInterface;
  private value: number;
  protected unit: string;

  constructor(value: string|number) {
    this.setValue(value);
  }

  getPoint(): PointInterface {
    return this.point;
  }

  setValue(value: string|number) {
    this.value = Number(value);
  }

  getValue(): number {
    return this.value;
  }

  setUnit(unit: string) {
    this.unit = unit;
  }

  getType(): string {
    return (<typeof Data>this.constructor).type;
  }

  getUnit(): string {
    return this.unit;
  }

  // @todo add correct type
  toJSON(): any {
    return {
      type: this.getType(),
      value: this.getValue() // @todo Pass type
    };
  }
}
