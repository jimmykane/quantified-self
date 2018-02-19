import {ActivityInterface} from './activity.interface';
import {CreatorInterface} from '../creators/creatorInterface';
import {PointInterface} from '../points/point.interface';
import {IDClass} from '../id/id.abstract.class';
import {DataInterface} from '../data/data.interface';
import {Log} from 'ng2-logger';
import {SummaryInterface} from '../summary/summary.interface';

export class Activity extends IDClass implements ActivityInterface {

  private type: string;
  private creator: CreatorInterface;
  private points: Map<number, PointInterface> = new Map<number, PointInterface>();
  private summary: SummaryInterface;
  private logger = Log.create('Activity');

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
    return this.getStartPoint().getDate();
  }

  getEndDate(): Date {
    return this.getEndPoint().getDate();
  }

  setCreator(creator: CreatorInterface) {
    this.creator = creator;
  }

  getCreator(): CreatorInterface {
    return this.creator;
  }

  // @todo should do short or somehow
  addPoint(point: PointInterface, detectCollision: boolean = true) {
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

  getPoints(startDate?: Date, endDate?: Date, step?: number): PointInterface[] {
    const points = [];
    let index = -1;
    this.points.forEach((point: PointInterface, date: number, map) => {
      index++;
      let canBeAdded = true;
      // @todo check inclusions
      if (step && index % step !== 0) {
        canBeAdded = false;
      }
      if (startDate && startDate >= point.getDate()) {
        canBeAdded = false;
      }
      if (endDate && endDate < point.getDate()) {
        canBeAdded = false;
      }
      if (canBeAdded) {
        points.push(point);
      }
    });
    return points;
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

  sortPointsByDate(): void {
    this.getPoints().sort((pointA: PointInterface, pointB: PointInterface) => {
      return pointA.getDate().getTime() - pointB.getDate().getTime();
    });
  }

  toJSON(): any {
    return {
      id: this.getID(),
      type: this.getType(),
      creator: this.getCreator().toJSON(),
      points: this.getPoints().reduce((jsonPointsArray: any[], point: PointInterface) => {
        jsonPointsArray.push(point.toJSON());
        return jsonPointsArray;
      }, []),
      summary: this.summary.toJSON()
    };
  }
}
