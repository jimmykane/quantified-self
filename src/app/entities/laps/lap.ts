import {LapInterface} from './lap.interface';
import {Summary} from '../summary/summary';

export class Lap implements LapInterface {

  public startDate: Date;
  public endDate: Date;
  public type: string;
  public summary = new Summary();

  constructor(startDate: Date, endDate: Date) {
    this.startDate = startDate;
    this.endDate = endDate;
  }

  toJSON(): any {
    return {
      startDate: this.startDate.toJSON(),
      endDate: this.endDate.toJSON(),
      type: this.type,
      summary: this.summary.toJSON(),
    };
  }
}
