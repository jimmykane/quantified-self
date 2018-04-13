import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {StatsClassInterface} from '../stats/stats.class.interface';

export interface LapInterface extends StatsClassInterface, SerializableClassInterface {
  startDate: Date;
  endDate: Date;
  type: string;
}
