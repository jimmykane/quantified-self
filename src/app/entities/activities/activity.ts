import {ActivityInterface} from './activity.interface';
import {CreatorInterface} from '../creators/creatorInterface';
import {PointInterface} from '../points/point.interface';
import {IDClass} from '../id/id.abstract.class';
import {DataInterface} from '../data/data.interface';
import {Log} from 'ng2-logger';
import {SummaryInterface} from '../summary/summary.interface';
import {LapInterface} from '../laps/lap.interface';
import {IBIData} from '../data/ibi/data.ibi';

export class Activity extends IDClass implements ActivityInterface {

  private startDate;
  private endDate;
  private type: string;
  private creator: CreatorInterface;
  private points: Map<number, PointInterface> = new Map<number, PointInterface>();
  private summary: SummaryInterface;
  private logger = Log.create('Activity');
  private ibiData: IBIData;
  private laps: LapInterface[] = [];


  constructor() {
    super();
  }

  setType(type: string) {
    this.type = type;
  }

  getType(): string {
    return this.type;
  }

  getStartDate(): Date {
    return this.startDate;
  }

  setStartDate(startDate: Date) {
    this.startDate = startDate;
  }

  getEndDate(): Date {
    return this.endDate;
  }

  setEndDate(endDate: Date) {
    this.endDate = endDate;
  }

  setCreator(creator: CreatorInterface) {
    this.creator = creator;
  }

  getCreator(): CreatorInterface {
    return this.creator;
  }

  // @todo should do short or somehow
  addPoint(point: PointInterface, detectCollision: boolean = true) {
    // @todo should do dateguard check
    const existingPoint = this.points.get(point.getDate().getTime());
    if (existingPoint && detectCollision) {
      this.logger.warn('Point collision detected for date: ' + point.getDate().toISOString() + ' and date: ' + existingPoint.getDate());
      existingPoint.getData().forEach((dataArray: DataInterface[], key: string, map) => {
        dataArray.forEach((data: DataInterface) => {
          if (!point.getDataByType(key)) {
            point.addData(data);
          }
        });
      });
    }
    this.points.set(point.getDate().getTime(), point);
  }

  removePoint(point: PointInterface) {
    this.points.delete(point.getDate().getTime());
  }

  getPoints(startDate?: Date, endDate?: Date, step?: number, sanitizeToSecond?: boolean): PointInterface[] {
    const points: Map<number, PointInterface> = new Map();
    let index = -1;
    this.points.forEach((point: PointInterface, date: number, map) => {
      index++;
      let canBeAdded = true;
      // @todo check inclusions
      if (step && index % step !== 0) {
        canBeAdded = false;
      }
      if (startDate && startDate > point.getDate()) {
        canBeAdded = false;
      }
      if (endDate && endDate < point.getDate()) {
        canBeAdded = false;
      }
      if (canBeAdded) {
        let key = point.getDate().getTime();
        // Merge to 1s precision and keep old data
        if (sanitizeToSecond) {
          // Put a key for the map to 0 ms so every 1s
          key = point.getDate().setMilliseconds(0);
          // Check if anything exists
          const existingPoint = points.get(key);
          if (existingPoint) {
            // If it exists use unique to add it to the iterating point (the current loop point)
            existingPoint.getData().forEach((dataArray: DataInterface[], key: string) => {
              dataArray.forEach((data: DataInterface) => {
                if (!point.getDataByType(key)) {
                  point.addData(data);
                }
              });
            });
          }
        }
        // Set the current loop point on the map
        points.set(key, point);
      }
    });
    return Array.from(points.values());
  }

  getStartPoint(): PointInterface {
    return this.getPoints()[0];
  }

  getEndPoint(): PointInterface {
    return this.getPoints()[this.getPoints().length - 1];
  }

  setSummary(activitySummary: SummaryInterface) {
    this.summary = activitySummary;
  }

  getSummary(): SummaryInterface {
    return this.summary;
  }

  setIBIData(ibiData: IBIData) {
    this.ibiData = ibiData;
  }

  getIBIData(): IBIData {
    return this.ibiData;
  }

  addLap(lap: LapInterface) {
    this.laps.push(lap);
  }

  getLaps(activity?: ActivityInterface): LapInterface[] {
    return this.laps;
  }

  sortPointsByDate(): void {
    this.getPoints().sort((pointA: PointInterface, pointB: PointInterface) => {
      return pointA.getDate().getTime() - pointB.getDate().getTime();
    });
  }

  toJSON(): any {
    return {
      id: this.getID(),
      startDate: this.getStartDate(),
      endDate: this.getEndDate(),
      type: this.getType(),
      creator: this.getCreator().toJSON(),
      points: this.getPoints().reduce((jsonPointsArray: any[], point: PointInterface) => {
        jsonPointsArray.push(point.toJSON());
        return jsonPointsArray;
      }, []),
      summary: this.summary.toJSON(),
      ibiData: this.getIBIData().toJSON(),
      laps: this.getLaps().reduce((jsonLapsArray: any[], lap: LapInterface) => {
        jsonLapsArray.push(lap.toJSON());
        return jsonLapsArray;
      }, []),
    };
  }
}
