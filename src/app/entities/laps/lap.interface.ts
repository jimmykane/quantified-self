import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {DataInterface} from '../data/data.interface';
import {DataDistance} from '../data/data.distance';
import {DataPause} from '../data/data.pause';
import {DataDuration} from '../data/data.duration';

export interface LapInterface extends SerializableClassInterface {
  startDate: Date;
  endDate: Date;
  type: string;

  getDistance(): DataInterface;
  getDuration(): DataInterface;
  getPause(): DataInterface;
  getStat(statType: string): DataInterface;
  getStats(): Map<string, DataInterface>;

  setDistance(distance: DataDistance);
  setDuration(duration: DataDuration);
  setPause(pause: DataPause);
  addStat(stat: DataInterface);
}
