import {CreatorInterface} from './creatorInterface';
import {ActivityInterface} from '../activities/activity.interface';
export class Creator implements CreatorInterface {
  private name: string;
  private activity: ActivityInterface;

  constructor(activity: ActivityInterface) {
    this.activity = activity;
    this.activity.addCreator(this);
  }

  getActivity(): ActivityInterface {
    return this.activity;
  }

  setName(name: string) {
    this.name = name;
  }

  getName(): string {
    return this.name;
  }

  toJSON(): any {
    return {
      name: this.getName()
    };
  }
}
