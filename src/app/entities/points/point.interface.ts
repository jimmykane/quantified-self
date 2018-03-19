import {DataInterface} from '../data/data.interface';
import {DataPositionInterface} from '../data/data.position.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';

export interface PointInterface extends SerializableClassInterface {
  getDate(): Date;
  addData(data: DataInterface);
  removeDataByType(dataType: string);
  getData(): Map<string, DataInterface>;
  getDataByType(dataType: string): DataInterface;
  getPosition(): DataPositionInterface;
}
