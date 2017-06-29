import {ActivityInterface} from './activity.interface';
import {CreatorInterface} from '../creators/creatorInterface';
import {LapInterface} from '../laps/lap.interface';
import {PointInterface} from '../points/point.interface';
import {EventInterface} from '../events/event.interface';
import {IDClass} from '../id/id.abstract.class';
import {DataInterface} from "../data/data.interface";

export class Activity extends IDClass implements ActivityInterface {

  private type: string;
  private creators: CreatorInterface[] = [];
  private points: Map<string, PointInterface> = new Map<string, PointInterface>();

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

  getDurationInSeconds(): number {
    return (+this.getEndDate() - +this.getStartDate()) / 1000;
  }

  addCreator(creator: CreatorInterface) {
    this.creators.push(creator);
  }

  getCreators(): CreatorInterface[] {
    return this.creators;
  }

  addPoint(point: PointInterface) {
    const existingPoint = this.points.get(point.getDate().toISOString());
    if (existingPoint) {
      console.warn('Point collision detected for date: ' + point.getDate().toISOString());
      existingPoint.getData().forEach((dataArray: DataInterface[], key: string, map) => {
        dataArray.forEach((data: DataInterface) => {
          point.addData(data);
        });
      });
    }
    this.points.set(point.getDate().toISOString(), point);
  }

  getPoints(startDate?: Date, endDate?: Date, step?: number): PointInterface[] {
    const points = [];
    let index = -1;
    this.points.forEach((point: PointInterface, date: string, map) => {
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

  toJSON(): any {
    return {
      id: this.getID(),
      type: this.getType(),
      creators: this.getCreators().reduce((jsonCreatorsArray: any[], creator: CreatorInterface) => {
        jsonCreatorsArray.push(creator.toJSON());
        return jsonCreatorsArray;
      }, []),
      points: this.getPoints().reduce((jsonPointsArray: any[], point: PointInterface) => {
        jsonPointsArray.push(point.toJSON());
        return jsonPointsArray;
      }, [])
    };
  }
}
