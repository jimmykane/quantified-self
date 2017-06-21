import {Point} from '../points/point';
import {DataInterface} from './data.interface';
import {PointInterface} from '../points/point.interface';

export class Data implements DataInterface {

  private point: PointInterface;
  private value: string;

  constructor(point: PointInterface, value: string) {
    this.point = point;
    this.point.addData(this);
    this.setValue(value);
  }

  getPoint(): PointInterface {
    return this.point;
  }

  setValue(value: string) {
    this.value = value;
  }

  getValue(): string {
    return this.value;
  }

  // @todo add correct type
  toJSON(): any {
    return {
      type: this.constructor.name,
      value: this.getValue() // @todo Pass type
    };
  }
}
