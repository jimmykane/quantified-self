import {LapInterface} from './lap.interface';
import {EventInterface} from '../events/event.interface';
import {Summary} from '../summary/summary';

export class Lap implements LapInterface {

  private event: EventInterface;
  private startDate: Date;
  private endDate: Date;
  private calories: number;
  private intensity: string;
  private triggerMethod: string;
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

  getDurationInSeconds(): number {
    return (+this.getEndDate() - +this.getStartDate()) / 1000;
  }

  setCalories(calories: number) {
    this.calories = calories;
    return this;
  }

  getCalories(): number {
    return this.calories;
  }

  setIntensity(intensity: string) {
    this.intensity = intensity;
    return this;
  }

  getIntensity(): string {
    return this.intensity;
  }

  setTriggerMethod(triggerMethod: string) {
    this.triggerMethod = triggerMethod;
    return this;
  }

  getTriggerMethod(): string {
    return this.triggerMethod;
  }

  setSummary(lapSummary: Summary) {
    this.summary = lapSummary;
  }

  getSummary(): Summary {
    return this.summary;
  }

  toJSON(): any {
    return {
      startDate: this.getStartDate(),
      endDate: this.getEndDate(),
      calories: this.getCalories(),
      intensity: this.getIntensity(),
      triggerMethod: this.getTriggerMethod(),
      summary: this.getSummary().toJSON(),
    };
  }
}
