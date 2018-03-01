import {DataInterface} from './data.interface';
import {PointInterface} from '../points/point.interface';

export abstract class Data implements DataInterface {

  static type: string;
  static unit: string;
  private point: PointInterface;
  private value: number;

  constructor(value: string | number) {
    this.setValue(value);
  }

  setPoint(point: PointInterface) {
    this.point = point;
  }

  getPoint(): PointInterface {
    return this.point;
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

  // @todo add correct type
  toJSON(): any {
    return {
      type: this.getType(),
      value: this.getValue() // @todo Pass type
    };
  }
}
