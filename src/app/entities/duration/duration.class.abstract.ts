import {DurationClassInterface} from './duration.class.interface';
import {StatsClassAbstract} from '../stats/stats.class.abstract';

export abstract class DurationClassAbstract extends StatsClassAbstract implements DurationClassInterface {
  startDate: Date;
  endDate: Date;

  protected constructor(statDate: Date, endDate: Date) {
    if (!statDate || !endDate) {
      throw new Error('Start and end dates are required');
    }
    super();
    this.startDate = statDate;
    this.endDate = endDate;
  }
}
