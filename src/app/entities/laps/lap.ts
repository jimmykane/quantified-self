import {LapInterface} from './lap.interface';
import {EventInterface} from '../events/event.interface';
import {Summary} from '../summary/summary';

export class Lap implements LapInterface {

  private event: EventInterface;
  private startDate: Date;
  private endDate: Date;
  private type: string;
  private summary: Summary;

  constructor(startDate: Date, endDate: Date) {
    this.setStartDate(startDate).setEndDate(endDate);
  }

  getEvent(): EventInterface {
    return this.event;
  }

  setStartDate(date: Date) {
    this.startDate = date;
    return this;
  }

  getStartDate(): Date {
    return this.startDate;
  }

  setEndDate(date: Date) {
    this.endDate = date;
    return this;
  }

  getEndDate(): Date {
    return this.endDate;
  }

  setType(type: string) {
    this.type = type;
    return this;
  }

  getType(): string {
    return this.type;
  }

  setSummary(lapSummary: Summary) {
    this.summary = lapSummary;
  }

  getSummary(): Summary {
    return this.summary;
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
