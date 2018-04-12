import {SerializableClassInterface} from '../serializable/serializable.class.interface';

export interface DataInterface extends SerializableClassInterface {
  getValue(): number;
  getType(): string;
  getUnit(): string;
  getClassName(): string;
  getUnitSystem(): UnitSystem;
}

export enum UnitSystem {
  Metric,
  Imperial
}
