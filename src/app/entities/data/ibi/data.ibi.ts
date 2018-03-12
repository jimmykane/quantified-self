import {SerializableClassInterface} from '../../serializable/serializable.class.interface';
import {IBIFilters} from './data.ibi.filters';

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
        if (ibiData > 0) {
          totalTime += ibiData;
          this.ibiDataMap.set(totalTime, ibiData);
        }
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
   * Low Limit filter. Removes all hr values above limit
   * @param {number} bpmLowPassLimit in BPM
   */
  public lowLimitBPMFilter(bpmLowPassLimit?: number): IBIData {
    IBIFilters.limitFilter(this, 60000 / (bpmLowPassLimit || 220), true);
    return this;
  }

  /**
   * High limit filter. Removes all hr values above limit
   * @param bpmHighPassLimit
   */
  public highLimitBPMFilter(bpmHighPassLimit?: number): IBIData {
    IBIFilters.limitFilter(this, 60000 / (bpmHighPassLimit || 40), false);
    return this;
  }

  /**
   *  Low pass filter
   * @param windowSize
   */
  public lowPassFilter(windowSize?: number): IBIData {
    IBIFilters.lowPassFilter(this, windowSize);
    return this;
  }

  /**
   * Step average filter
   * @param {number} step
   * @return {this}
   */
  public stepAverageFilter(step?: number) {
    IBIFilters.stepAverageFilter(this, step);
    return this;
  }

  /**
   * Moving median filter
   * @param {number} windowSize
   * @return {this}
   */
  public movingMedianFilter(windowSize?: number) {
    IBIFilters.movingMedianFilter(this, windowSize);
    return this;
  }

  toJSON(): any {
    return Array.from(this.ibiDataMap.values());
  }
}
