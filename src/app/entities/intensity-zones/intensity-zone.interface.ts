import {SerializableClassInterface} from '../serializable/serializable.class.interface';

export interface ZonesInterface extends SerializableClassInterface {
  zone1Duration: number;
  zone2Duration: number;
  zone2LowerLimit: number;
  zone3Duration: number;
  zone3LowerLimit: number;
  zone4Duration: number;
  zone4LowerLimit: number;
  zone5Duration: number;
  zone5LowerLimit: number;
}
