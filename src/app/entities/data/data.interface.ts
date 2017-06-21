import {PointInterface} from '../points/point.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';

export interface DataInterface extends SerializableClassInterface {
  getPoint(): PointInterface;
  setValue(value: string);
  getValue(): string;
}
