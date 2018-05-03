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
    if (!startDate || !endDate) {
      throw new Error('Lap start date and end date is required');
    }
    this.startDate = startDate;
    this.endDate = endDate;
  }

  toJSON(): any {
    const stats = [];
    this.stats.forEach((value: DataInterface, key: string) => {
      stats.push(value.toJSON());
    });
    return {
      id: this.getID(),
      startDate: this.startDate.toJSON(),
      endDate: this.endDate.toJSON(),
      type: this.type,
      stats: stats
    };
  }
}
