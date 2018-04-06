import {CreatorInterface} from './creatorInterface';
import {ActivityInterface} from '../activities/activity.interface';
export class Creator implements CreatorInterface {
  public name: string;
  public swInfo: string;
  public hwInfo: string;
  public serialNumber: string;

  toJSON(): any {
    return {
      name: this.name,
      serialNumber: this.serialNumber,
      swInfo: this.swInfo,
      hwInfo: this.hwInfo
    };
  }
}
