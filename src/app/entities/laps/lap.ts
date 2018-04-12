import {LapInterface} from './lap.interface';
import {DataInterface} from '../data/data.interface';
import {DataDistance} from '../data/data.distance';
import {DataDuration} from '../data/data.duration';
import {DataPause} from '../data/data.pause';

export class Lap implements LapInterface {

  public startDate: Date;
  public endDate: Date;
  public type: string; // @todo make Enum
  public stats = new Map<string, DataInterface>();


  constructor(startDate: Date, endDate: Date) {
    this.startDate = startDate;
    this.endDate = endDate;
  }

  getDistance(): DataInterface {
    return this.stats.get(DataDistance.className);
  }

  getDuration(): DataInterface {
    return this.stats.get(DataDuration.className);
  }

  getPause(): DataInterface {
    return this.stats.get(DataPause.className);
  }

  getStat(statType: string): DataInterface {
    return this.stats.get(statType);
  }

  getStats(): Map<string, DataInterface> {
    return this.stats;
  }

  setDistance(distance: DataDistance) {
    this.stats.set(DataDistance.className, distance);
  }

  setDuration(duration: DataDuration) {
    this.stats.set(DataDuration.className, duration);
  }

  setPause(pause: DataPause) {
    this.stats.set(DataPause.className, pause);
  }

  addStat(stat: DataInterface) {
    this.stats.set(stat.getClassName(), stat);
  }

  toJSON(): any {
    const stats = {};
    this.stats.forEach((value: DataInterface, key: string) => {
      stats[key] = value.toJSON();
    });
    return {
      startDate: this.startDate.toJSON(),
      endDate: this.endDate.toJSON(),
      type: this.type,
      stats: stats
    };
  }


}
