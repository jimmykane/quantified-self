import {ActivityInterface} from '../activities/activity.interface';
import {PointInterface} from '../points/point.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';

export interface LapInterface extends SerializableClassInterface {

  getActivity(): ActivityInterface;

  getPoints(): PointInterface[];

  setStartDate(date: Date);
  getStartDate(): Date;

  setEndDate(date: Date);
  getEndDate(): Date;

  getDistanceInMeters(): number;

  getTotalTimeInSeconds(): number;

  setCalories(calories: number);
  getCalories(): number;

  setIntensity(intensity: string);
  getIntensity(): string;

  setTriggerMethod(triggerMethod: string);
  getTriggerMethod(): string;
}
