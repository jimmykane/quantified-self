import {DataDuration} from '../data/data.duration';
import {DataDistance} from '../data/data.distance';
import {DataInterface} from '../data/data.interface';
import {DataPause} from '../data/data.pause';
import {IDClassInterface} from '../id/id.class.interface';

export interface StatsClassInterface extends IDClassInterface {
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
