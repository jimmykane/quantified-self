import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {StatsClassInterface} from '../stats/stats.class.interface';
import {DurationClassInterface} from '../duration/duration.class.interface';

export interface LapInterface extends StatsClassInterface, DurationClassInterface, SerializableClassInterface {
  type: string;
}
