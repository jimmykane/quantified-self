import {ActivityInterface} from '../activities/activity.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
export interface CreatorInterface extends SerializableClassInterface{
  getActivity(): ActivityInterface;
  setName(name: string);
  getName(): string;
}
