import {DataDuration} from '../data/data.duration';
import {DataDistance} from '../data/data.distance';
import {DataInterface} from '../data/data.interface';
import {DataPause} from '../data/data.pause';
import {IDClassInterface} from '../id/id.class.interface';

export interface StatsClassInterface extends IDClassInterface {
  getDistance(): DataDistance;
  getDuration(): DataDuration;
  getPause(): DataPause;
  getStat(statType: string): DataInterface;
  getStats(): Map<string, DataInterface>;
  removeStat(statType: string);

  setDistance(distance: DataDistance);
  setDuration(duration: DataDuration);
  setPause(pause: DataPause);
  addStat(stat: DataInterface);
}
