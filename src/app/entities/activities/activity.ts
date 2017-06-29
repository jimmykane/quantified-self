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
      // Noop here for now @todo solve this
      return;
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

  getDataByType(dataType?: string, startDate?: Date, endDate?: Date, step?: number): DataInterface[] {
    const t0 = performance.now();
    const data = this.getPoints(startDate, endDate, step)
      .reduce((dataArray: DataInterface[], point: PointInterface, currentIndex) => {
        point.getDataByType(dataType).forEach((pointData: DataInterface) => {
          dataArray.push(pointData);
        });
        return dataArray;
      },  []);
    console.log('Activity: Retrieved data for  ' + dataType + ' after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return data;
  }

  getDataTypeAverage(dataType: string, startDate?: Date, endDate?: Date, step?: number): number {
    const t0 = performance.now();
    let count = 1;
    const averageForDataType = this.getPoints(startDate, endDate, step).reduce((average: number, point: PointInterface) => {
      if (!point.getDataTypeAverage(dataType)) {
        return average;
      }
      average += point.getDataTypeAverage(dataType);
      count++;
      return average;
    }, 0);
    console.log('Activity: Calculated average for ' + dataType + ' after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return averageForDataType / count;
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
