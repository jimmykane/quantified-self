import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {EventInterface} from '../events/event.interface';
import {Summary} from '../summary/summary';
import {SummaryInterface} from '../summary/summary.interface';

export interface LapInterface extends SerializableClassInterface {
  startDate: Date;
  endDate: Date;
  type: string;
  summary: SummaryInterface;
}
