import {IBIData} from './data.ibi';
import * as createMedianFilter from 'moving-median';

/**
 * Collection of filters parsers and converters for IBI (R-R) data
 */
export class IBIFilters {

  /**
   * A pass filter. It removes all values outside the limit
   * @param {IBIData} ibiData
   * @param {number} passLimit
   * @param {boolean} lowPass
   */
  public static passFilter(ibiData: IBIData, passLimit: number, lowPass: boolean) {
    ibiData.getIBIData().forEach((value, key, map) => {
      if (value < passLimit && lowPass) {
        ibiData.getIBIData().delete(key);
      } else if (value > passLimit && !lowPass) {
        ibiData.getIBIData().delete(key)
      }
    });
  }

  /**
   * A step average filter.
   * Buffers and converts the buffer to the average of the buffer
   * @param {IBIData} ibiData
   * @param {number} step
   * @return {Map<any, any>}
   */
  public static stepAverageFilter(ibiData: IBIData, step?: number) {
    step = step || 2;
    const bufferMap = new Map();
    ibiData.getIBIData().forEach((ibi, elapsedTime) => {
      bufferMap.set(elapsedTime, ibi);
      if (bufferMap.size >= step) {
        // Find the value average
        const avgValue = Array.from(bufferMap.values()).reduce((total, value) => {
          return total + value;
        }) / bufferMap.size;
        // For all the keys that got averaged set that value to the original object
        bufferMap.forEach((value, key) => {
          ibiData.setIBI(key, avgValue);
        });
        // Clear
        bufferMap.clear();
      }
    });
    return bufferMap;
  }

  /**
   * Running median filter
   * @param {IBIData} ibiData
   * @param {number} windowSize
   */
  public static movingMedianFilter(ibiData: IBIData, windowSize?: number) {
    windowSize = windowSize || 5;
    const medianFilter = createMedianFilter(windowSize);
    ibiData.getIBIData().forEach((ibi, elapsedTime) => {
      ibiData.setIBI(elapsedTime, medianFilter(ibi));
    });
  }

  // /**
  //  * Returns an Map of elapsed time and HR from RR data
  //  * @param rr
  //  * @param {number} sampleRateInSeconds
  //  * @return {number[]}
  //  */
  // public static getHRFromRR(rr, sampleRateInSeconds?: number): Map<number, number> {
  //   sampleRateInSeconds = sampleRateInSeconds || 10; // Use any second number
  //   const limit = sampleRateInSeconds * 1000;
  //   let totalTime = 0;
  //   let rrBuffer = [];
  //   return rr.reduce((hr, d) => {
  //     // add it to the buffer
  //     rrBuffer.push(d);
  //     // Increase total time
  //     totalTime += d;
  //     // Check if buffer is full
  //     const time = rrBuffer.reduce((a, b) => a + b, 0); // gets the sum of the buffer [300+600 etc]
  //     if (time >= limit) {
  //       hr.set(totalTime, rrBuffer.length * 60 / (time / 1000)); // convert to bpm
  //       rrBuffer = [];
  //     }
  //     return hr;
  //   }, new Map());
  // }
}
