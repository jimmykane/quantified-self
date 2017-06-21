import {LapInterface} from './lap.interface';
import {ActivityInterface} from '../activities/activity.interface';
import {PointInterface} from '../points/point.interface';

export class Lap implements LapInterface {

  private activity: ActivityInterface;
  private startDate: Date;
  private endDate: Date;
  private calories: number;
  private intensity: string;
  private triggerMethod: string;

  constructor(activity: ActivityInterface) {
    this.activity = activity;
    this.activity.addLap(this);
  }

  getActivity(): ActivityInterface {
    return this.activity;
  }

  getPoints(): PointInterface[] {
    const lapPoints: PointInterface[] = [];
    for (const point of this.activity.getPoints()) {
      // Attention, some points in TCX do not follow this rule and seem to loose
      if (point.getDate().getTime() >= this.getStartDate().getTime() && point.getDate().getTime() < this.getEndDate().getTime()) {
        lapPoints.push(point);
      }
    }
    return lapPoints;
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
    return this.getActivity().getEvent().getGeodesyAdapter().getDistance(this.getPoints());
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
