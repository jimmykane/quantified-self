import {SerializableClassInterface} from '../../serializable/serializable.class.interface';

export class IBIData implements SerializableClassInterface {

  /**
   * Key is time elapsed since start of the array
   * value is the interval
   * @type {Map<number, number>}
   */
  private ibiDataMap: Map<number, number> = new Map<number, number>();

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

  public getIBIData(): Map<number, number> {
    return this.ibiDataMap;
  }

  public getAsHR(): Map<number, number> {
    const hrDataMap = new Map();
    this.ibiDataMap.forEach((value, key, map) => {
      hrDataMap.set(key, Math.round(60000 / value))
    });
    return hrDataMap;
  }

  toJSON(): any {
    return this.getIBIDataArray();
  }
}
