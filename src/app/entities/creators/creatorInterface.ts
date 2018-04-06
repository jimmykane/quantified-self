import {SerializableClassInterface} from '../serializable/serializable.class.interface';
export interface CreatorInterface extends SerializableClassInterface {
  name: string;
  serialNumber: string;
  swInfo: string;
  hwInfo: string;
}
