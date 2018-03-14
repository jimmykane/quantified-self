import {SerializableClassInterface} from '../../serializable/serializable.class.interface';
import {IBIFilters} from './data.ibi.filters';

export class IBIData implements SerializableClassInterface {

  /**
   * Key is time time since start of the array
   * value is the ibi
   * @type {Map<number, number>}
   */
  private ibiDataMap: Map<number, number> = new Map<number, number>();

  constructor(ibiDataArray?: Array<number>) {
    if (ibiDataArray) {
      this.parseIBIArray(ibiDataArray);
    }
  }

  /**
   * Parses an IBI data array
   * eg: [600, 600, 100] becomes a map of {600:600, 1200: 600, 1300:100}
   * @param {Array<number>} ibiArray
   */
  public parseIBIArray(ibiArray: Array<number>) {
    ibiArray.reduce((totalTime, ibiData) => {
      if (ibiData > 0) {
        totalTime += ibiData;
        this.ibiDataMap.set(totalTime, ibiData);
      }
      return totalTime;
    }, 0)
  }

  /**
   * Sets the ibi for the specific time
   * @param time
   * @param ibi
   */
  public setIBI(time, ibi) {
    this.ibiDataMap.set(time, ibi)
  }

  /**
   * Gets the IBI data map
   * @return {Map<number, number>}
   */
  public getIBIDataMap(): Map<number, number> {
    return this.ibiDataMap;
  }

  /**
   * Gets the IBI data map but uses BPM units instead of IBI
   * @return {Map<number, number>}
   */
  public getAsBPM(): Map<number, number> {
    const hrDataMap = new Map();
    this.ibiDataMap.forEach((value, key, map) => {
      hrDataMap.set(key, 60000 / value)
    });
    return hrDataMap;
  }

  /**
   * Low Limit filter. Removes all hr values above limit
   * @param {number} bpmLowLimit in BPM
   */
  public lowLimitBPMFilter(bpmLowLimit?: number): IBIData {
    IBIFilters.limitFilter(this,60000 / (bpmLowLimit || 40), false); // Lower bpm higher IBI limit!
    return this;
  }

  /**
   * High limit filter. Removes all hr values above limit
   * @param bpmHighLimit
   */
  public highLimitBPMFilter(bpmHighLimit?: number): IBIData {
    IBIFilters.limitFilter(this,  60000 / (bpmHighLimit || 220), true); // Higher bpm lower IBI limit!
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
