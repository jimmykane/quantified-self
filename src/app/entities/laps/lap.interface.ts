import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {EventInterface} from '../events/event.interface';
import {Summary} from '../summary/summary';

export interface LapInterface extends SerializableClassInterface {

  getEvent(): EventInterface;

  setStartDate(date: Date);
  getStartDate(): Date;

  setEndDate(date: Date);
  getEndDate(): Date;

  getDurationInSeconds(): number;

  setCalories(calories: number);
  getCalories(): number;

  setIntensity(intensity: string);
  getIntensity(): string;

  setTriggerMethod(triggerMethod: string);
  getTriggerMethod(): string;

  setSummary(lapSummary: Summary);
  getSummary(): Summary;
}
