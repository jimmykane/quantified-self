import {ActivityInterface} from './activity.interface';
import {CreatorInterface} from '../creators/creatorInterface';
import {LapInterface} from '../laps/lap.interface';
import {PointInterface} from '../points/point.interface';
import {EventInterface} from '../events/event.interface';
import {IDClass} from '../id/id.abstract.class';
import {DataInterface} from "../data/data.interface";

export class Activity extends IDClass implements ActivityInterface {

  private event: EventInterface;
  private type: string;
  private creators: CreatorInterface[] = [];
  private laps: LapInterface[] = [];
  private points: Map<string, PointInterface> = new Map<string, PointInterface>();

  constructor(event: EventInterface) {
    super();
    this.event = event;
    this.event.addActivity(this);
  }

  getEvent(): EventInterface {
    return this.event;
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

  getDurationInSeconds (): number {
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

  getData(startDate?: Date, endDate?: Date, step?: number): Map<string, DataInterface[]> {
    return this.getPoints(startDate, endDate, step).reduce((dataMap: Map<string, DataInterface[]>, point: PointInterface, currentIndex) => {
      point.getData().forEach((data: DataInterface[], key: string) => {
        dataMap.set(key, [...dataMap.get(key) || [], ...data]);
      });
      return dataMap;
    }, new Map<string, DataInterface[]>());
  }

  getDataByType(dataType: string): DataInterface[] {
    return this.getData().get(dataType) || [];
  }

  getDataTypeAverage(dataType: string): number {
    return this.getDataByType(dataType).reduce((average: number, data, currentIndex, array) => {
        return average + data.getValue() / array.length
      }, 0);
  }

  getStartPoint(): PointInterface {
    return this.getPoints()[0];
  }

  getEndPoint(): PointInterface {
    return this.getPoints()[this.getPoints().length - 1];
  }

  addLap(lap: LapInterface) {
    this.laps.push(lap);
  }

  getLaps(): LapInterface[] {
    return this.laps;
  }

  getDistanceInMeters(): number {
    return this.getEvent().getGeodesyAdapter().getDistance(this.getPoints());
  }

  getLapsDistanceInMeters(): number {
    let lapDistance = 0;
    for (const lap of this.getLaps()){
      lapDistance += lap.getDistanceInMeters();
    }
    return lapDistance;
  }

  toJSON(): any {
    return {
      id: this.getID(),
      type: this.getType(),
      creators: this.getCreators().reduce((jsonCreatorsArray: any[], creator: CreatorInterface) => {
        jsonCreatorsArray.push(creator.toJSON());
        return jsonCreatorsArray;
      }, []),
      laps: this.getLaps().reduce((jsonLapsArray: any[], lap: LapInterface) => {
        jsonLapsArray.push(lap.toJSON());
        return jsonLapsArray;
      }, []),
      points: this.getPoints().reduce((jsonPointsArray: any[], point: PointInterface) => {
        jsonPointsArray.push(point.toJSON());
        return jsonPointsArray;
      }, [])
    };
  }
}
