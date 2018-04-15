import {SerializableClassInterface} from '../serializable/serializable.class.interface';

export interface DataInterface extends SerializableClassInterface {
  setValue(value: number | string | Date);

  getValue(): number | string | Date;

  getDisplayValue(): number | string | Date;

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
