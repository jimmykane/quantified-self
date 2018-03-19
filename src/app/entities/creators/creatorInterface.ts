import {ActivityInterface} from '../activities/activity.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
export interface CreatorInterface extends SerializableClassInterface {
  name: string;

  setActivity(activity: ActivityInterface);
  getActivity(): ActivityInterface;

  setSerialNumber(serialNumber: string);
  getSerialNumber(): string;

  getSWInfo(): string;
  setSWInfo(swInfo: string);
  getHWInfo(): string;
  setHWInfo(hwInfo: string);

}
