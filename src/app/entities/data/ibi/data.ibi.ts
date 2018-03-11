import {SerializableClassInterface} from '../../serializable/serializable.class.interface';
import {IBIFilters} from "./data.ibi.filters";

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

  public setIBI(elapsedTime, ibi) {
    this.ibiDataMap.set(elapsedTime, ibi)
  }

  public getIBIData(): Map<number, number> {
    return this.ibiDataMap;
  }

  public getAsBPM(): Map<number, number> {
    const hrDataMap = new Map();
    this.ibiDataMap.forEach((value, key, map) => {
      hrDataMap.set(key, Math.round(60000 / value))
    });
    return hrDataMap;
  }

  /**
   * Low pass filter. Removes all hr values above limit
   * @param {number} bpmLowPassLimit in BPM
   */
  public lowPassBPMFilter(bpmLowPassLimit?: number): IBIData {
    IBIFilters.passFilter(this, 60000 / (bpmLowPassLimit || 220), true);
    return this;
  }

  /**
   * Low pass filter. Removes all hr values above limit
   * @param bpmHighPassLimit
   */
  public highPassBPMFilter(bpmHighPassLimit?: number): IBIData {
    IBIFilters.passFilter(this, 60000 / (bpmHighPassLimit || 40), false);
    return this;
  }

  public stepAverageFilter(step?: number){
    IBIFilters.filterOnStepAverage(this, step);
    return this;
  }

  toJSON(): any {
    return Array.from(this.ibiDataMap.values());
  }
}
