import {SerializableClassInterface} from '../serializable/serializable.class.interface';

export interface DataInterface extends SerializableClassInterface {
  setValue(value: number | string);

  getValue(): number | string;

  getDisplayValue(): number | string;

  getType(): string;

  getUnit(): string;

  getDisplayUnit(): string;

  getClassName(): string;

  getUnitSystem(): UnitSystem;
}

export enum UnitSystem {
  Metric,
  Imperial
}
