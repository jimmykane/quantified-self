import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {EventInterface} from '../events/event.interface';

export interface LapInterface extends SerializableClassInterface {

  getEvent(): EventInterface;

  setStartDate(date: Date);
  getStartDate(): Date;

  setEndDate(date: Date);
  getEndDate(): Date;

  getTotalTimeInSeconds(): number;

  setCalories(calories: number);
  getCalories(): number;

  setIntensity(intensity: string);
  getIntensity(): string;

  setTriggerMethod(triggerMethod: string);
  getTriggerMethod(): string;
}
