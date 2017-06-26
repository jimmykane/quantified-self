import {PointInterface} from '../points/point.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {EventInterface} from '../events/event.interface';

export interface LapInterface extends SerializableClassInterface {

  getEvent(): EventInterface;

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
