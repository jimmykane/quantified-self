import {DurationClassInterface} from './duration.class.interface';

export abstract class DurationClassAbstract implements DurationClassInterface {
  startDate: Date;
  endDate: Date;

  protected constructor(statDate: Date, endDate: Date) {
    if (!statDate || !endDate) {
      throw new Error('Start and end dates are required');
    }
    this.startDate = statDate;
    this.endDate = endDate;
  }
}
