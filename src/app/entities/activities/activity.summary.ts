import {SummaryInterface} from '../summary/summary.interface';

export class ActivitySummary implements SummaryInterface {

  private totalDurationInSeconds: number;
  private totalDistanceInMeters: number;

  setTotalDurationInSeconds(totalDurationInSeconds: number) {
    this.totalDurationInSeconds = totalDurationInSeconds;
  }

  getTotalDurationInSeconds(): number {
    return this.totalDurationInSeconds;
  }

  setTotalDistanceInMeters(totalDistanceInMeters: number) {
    this.totalDistanceInMeters = totalDistanceInMeters;
  }

  getTotalDistanceInMeters(): number {
    return this.totalDistanceInMeters;
  }

  toJSON(): any {
    return {
      totalDurationInSeconds: this.totalDurationInSeconds,
      totalDistanceInMeters: this.totalDistanceInMeters,
    };
  }
}
