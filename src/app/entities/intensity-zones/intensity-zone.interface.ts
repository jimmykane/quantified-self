import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {EventInterface} from '../events/event.interface';
import {Summary} from '../summary/summary';

export interface LapInterface extends SerializableClassInterface {

  getEvent(): EventInterface;

  setStartDate(date: Date);
  getStartDate(): Date;

  setEndDate(date: Date);
  getEndDate(): Date;

  setType(type: string);
  getType(): string;

  setSummary(lapSummary: Summary);
  getSummary(): Summary;
}
