import {ActivityInterface} from 'app/entities/activities/activity.interface';
import {GeodesyAdapterInterface} from '../geodesy/adapters/adapter.interface';
import {PointInterface} from '../points/point.interface';
import {IDClassInterface} from '../id/id.class.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {DataInterface} from "../data/data.interface";

export interface EventInterface extends IDClassInterface, SerializableClassInterface {
  getGeodesyAdapter(): GeodesyAdapterInterface;
  setName(name: string);
  getName(): string;
  addActivity(activity: ActivityInterface);
  removeActivity(activity: ActivityInterface);
  getActivities(): ActivityInterface[];
  getFirstActivity(): ActivityInterface;
  getLastActivity(): ActivityInterface;
  getPoints(startDate?: Date, endDate?: Date, step?: number): PointInterface[];
  getData(startDate?: Date, endDate?: Date, step?: number): Map<string, DataInterface[]>;
  getDataByType(dataType: string): DataInterface[];
  getDistanceInMeters(): number;
  getDurationInSeconds(): number;
}
