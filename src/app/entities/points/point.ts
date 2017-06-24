import {PointInterface} from './point.interface';
import {ActivityInterface} from '../activities/activity.interface';
import {DataInterface} from '../data/data.interface';
import {DataLatitudeDegrees} from '../data/data.latitude-degrees';
import {DataPositionInterface} from '../data/data.position.interface';
import {DataLongitudeDegrees} from '../data/data.longitude-degrees';

export class Point implements PointInterface {

  private activity: ActivityInterface;
  private date: Date;
  private position: DataPositionInterface;
  private data: Map<string, DataInterface[]> = new Map<string, DataInterface[]>();


  constructor(activity: ActivityInterface, date: Date) {
    this.date = date;
    this.activity = activity;
    this.activity.addPoint(this);
  }

  getActivity(): ActivityInterface {
    return this.activity;
  }

  getDate(): Date {
    return this.date;
  }

  addData(data: DataInterface) {
    const dataArray = this.getData().get(data.constructor.name) || [];
    if (!dataArray.length) {
      this.getData().set(data.constructor.name, dataArray);
    }
    dataArray.push(data);
  }

  getData(): Map<string, DataInterface[]> {
    return this.data;
  }

  getDataByType(dataType: string): DataInterface[] {
    return this.getData().get(dataType);
  }

  getDataTypeAverage(dataType: string): number {
    return this.getDataByType(dataType).reduce((average: number, data, currentIndex, array) => {
        return average + data.getValue() / array.length
      }, 0);
  }

  getPosition(): DataPositionInterface {
    const dataLatitudeDegrees = this.getData().get(DataLatitudeDegrees.name);
    const dataLongitudeDegrees = this.getData().get(DataLongitudeDegrees.name);
    if (!dataLongitudeDegrees || !dataLatitudeDegrees){
      return;
    }
    this.position = {
      latitudeDegrees: Number(dataLatitudeDegrees[0].getValue()),
      longitudeDegrees: Number(dataLongitudeDegrees[0].getValue())
    };
    return this.position;
  }

  toJSON(): any {
    let dataArray = [];
    this.getData().forEach((value, key, map) => {
      dataArray = [...dataArray, ...value];
    });
    return {
      date: this.getDate(),
      data: dataArray.reduce((jsonDataArray: any[], data: DataInterface) => {
        jsonDataArray.push(data.toJSON());
        return jsonDataArray;
      }, [])
    };
  }
}
