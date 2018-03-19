import {CreatorInterface} from './creatorInterface';
import {ActivityInterface} from '../activities/activity.interface';
export class Creator implements CreatorInterface {
  public name: string;

  private swInfo: string;
  private hwInfo: string;
  private serialNumber: string;
  private activity: ActivityInterface;

  setActivity(activity: ActivityInterface){
    this.activity = activity;
  }

  getActivity(): ActivityInterface {
    return this.activity;
  }

  setSerialNumber(serialNumber: string) {
    this.serialNumber = serialNumber;
  }

  getSerialNumber(): string {
    return this.serialNumber;
  }

  getSWInfo(): string {
    return this.swInfo;
  }

  setSWInfo(swInfo: string) {
    this.swInfo = swInfo;
  }

  getHWInfo(): string {
    return this.hwInfo;
  }

  setHWInfo(hwInfo: string) {
    this.hwInfo = hwInfo;
  }

  toJSON(): any {
    return {
      name: this.name,
      serialNumber: this.getSerialNumber(),
      swInfo: this.getSWInfo(),
      hwInfo: this.getHWInfo()
    };
  }
}
