import {LapInterface} from './lap.interface';
import {DataInterface} from '../data/data.interface';
import {StatsClassAbstract} from '../stats/stats.class.abstract';

export class Lap extends StatsClassAbstract implements LapInterface {

  public startDate: Date;
  public endDate: Date;
  public type: string; // @todo make Enum

  public stats = new Map<string, DataInterface>();

  constructor(startDate: Date, endDate: Date) {
    super();
    this.startDate = startDate;
    this.endDate = endDate;
  }

  toJSON(): any {
    const stats = [];
    this.stats.forEach((value: DataInterface, key: string) => {
      stats.push(value.toJSON());
    });
    return {
      startDate: this.startDate.toJSON(),
      endDate: this.endDate.toJSON(),
      type: this.type,
      stats: stats
    };
  }
}
