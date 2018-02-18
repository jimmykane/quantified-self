import {ActivityInterface} from '../activities/activity.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
export interface CreatorInterface extends SerializableClassInterface {
  setActivity(activity: ActivityInterface);
  getActivity(): ActivityInterface;
  setName(name: string);
  getName(): string;

  setSerialNumber(serialNumber: string);
  getSerialNumber(): string;

  getSWInfo(): string;
  setSWInfo(swInfo: string);
  getHWInfo(): string;
  setHWInfo(hwInfo: string);

}
