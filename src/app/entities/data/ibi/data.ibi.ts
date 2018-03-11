import {SerializableClassInterface} from '../../serializable/serializable.class.interface';

export class IBIData implements SerializableClassInterface {

  private ibiDataMap: Map<number, number> = new Map();

  constructor(ibiDataArray?: Array<number>) {
    if (ibiDataArray) {
      ibiDataArray.reduce((totalTime, ibiData) => {
        totalTime += ibiData;
        this.ibiDataMap.set(totalTime, ibiData);
        return totalTime;
      }, 0)
    }
  }

  public getIBIDataArray(): Array<number> {
    return Array.from(this.ibiDataMap.values());
  }

  toJSON(): any {
    return this.getIBIDataArray();
  }
}
