import {LapInterface} from './lap.interface';
import {DataInterface} from '../data/data.interface';
import {DurationClassAbstract} from '../duration/duration.class.abstract';
import {LapTypes} from './lap.types';

export class Lap extends DurationClassAbstract implements LapInterface {

  public type: LapTypes;

  constructor(startDate: Date, endDate: Date) {
    super(startDate, endDate);
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
