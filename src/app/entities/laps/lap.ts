import {LapInterface} from './lap.interface';
import {ActivityInterface} from '../activities/activity.interface';
import {PointInterface} from '../points/point.interface';
import {EventInterface} from "../events/event.interface";

export class Lap implements LapInterface {

  private event: EventInterface;
  private startDate: Date;
  private endDate: Date;
  private calories: number;
  private intensity: string;
  private triggerMethod: string;

  constructor(event: EventInterface) {
    this.event = event;
    this.event.addLap(this);
  }

  getEvent(): EventInterface {
    return this.event;
  }

  getPoints(): PointInterface[] {
    return this.getEvent().getPoints(this.getStartDate(), this.getEndDate());
  }

  getPointsWithPosition(startDate?: Date, endDate?: Date, step?: number): PointInterface[] {
    return this.getEvent().getPointsWithPosition(startDate, endDate, step);
  }

  setStartDate(date: Date) {
    this.startDate = date;
  }

  getStartDate(): Date {
    return this.startDate;
  }

  setEndDate(date: Date) {
    this.endDate = date;
  }

  getEndDate(): Date {
    return this.endDate;
  }

  getDistanceInMeters(): number {
    return this.getEvent().getGeodesyAdapter().getDistance(this.getPointsWithPosition());
  }

  getTotalTimeInSeconds(): number {
    return (this.getEndDate().getTime() - this.getStartDate().getTime()) / 1000;
  }

  setCalories(calories: number) {
    this.calories = calories;
  }

  getCalories(): number {
    return this.calories;
  }

  setIntensity(intensity: string) {
    this.intensity = intensity;
  }

  getIntensity(): string {
    return this.intensity;
  }

  setTriggerMethod(triggerMethod: string) {
    this.triggerMethod = triggerMethod;
  }

  getTriggerMethod(): string {
    return this.triggerMethod;
  }

  toJSON(): any {
    return {
      startDate: this.getStartDate(),
      endDate: this.getEndDate(),
      calories: this.getCalories(),
      intensity: this.getIntensity(),
      triggerMethod: this.getTriggerMethod()
    };
  }
}
