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
  private points: PointInterface[] = [];

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
    this.points.push(point);
  }

  getPoints(): PointInterface[] {
    return this.points;
  }

  getData(): Map<string, DataInterface[]> {
    return this.getPoints().reduce((dataMap: Map<string, DataInterface[]>, point: PointInterface, currentIndex) => {
      point.getData().forEach((data: DataInterface[], key: string) => {
        dataMap.set(key, [...dataMap.get(key) || [], ...data]);
      });
      return dataMap;
    }, new Map<string, DataInterface[]>());
  }

  getDataByType(dataType: string): DataInterface[] {
    return this.getData().get(dataType);
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

  sortPointsByDate(): void {
    this.getPoints().sort((pointA: PointInterface, pointB: PointInterface) => {
      return pointA.getDate().getTime() - pointB.getDate().getTime();
    });
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
