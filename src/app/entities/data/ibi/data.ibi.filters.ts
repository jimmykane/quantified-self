import {IBIData} from './data.ibi';
import * as CreateMedianFilter from 'moving-median';
import * as LowPassFilter from 'lowpassf';

/**
 * Collection of filters parsers and converters for IBI (R-R) data
 */
export class IBIFilters {

  /**
   * A limit filter. It removes all values outside the limit
   * @param {IBIData} ibiData
   * @param {number} limit
   * @param {boolean} lowLimit
   */
  public static limitFilter(ibiData: IBIData, limit: number, lowLimit: boolean) {
    ibiData.getIBIDataMap().forEach((value, key, map) => {
      if (value < limit && lowLimit) {
        map.delete(key);
      } else if (value > limit && !lowLimit) {
        map.delete(key)
      }
    });
  }

  /**
   * A step average filter.
   * Buffers and converts the buffer to the average of the buffer
   * @param {IBIData} ibiData
   * @param {number} step
   * @return {Map<number, number>}
   */
  public static stepAverageFilter(ibiData: IBIData, step?: number) {
    step = step || 2;
    const bufferMap = new Map<number, number>();
    ibiData.getIBIDataMap().forEach((ibi, elapsedTime) => {
      bufferMap.set(elapsedTime, ibi);
      if (bufferMap.size >= step) {
        // Find the value average
        const avgValue = Array.from(bufferMap.values()).reduce((total, value) => {
          return total + value;
        }) / bufferMap.size;
        // For all the keys that got averaged set that value to the original object
        bufferMap.forEach((value, key) => {
          ibiData.setIBI(key, Math.round(avgValue));
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
    const medianFilter = CreateMedianFilter(windowSize);
    ibiData.getIBIDataMap().forEach((ibi, elapsedTime) => {
      ibiData.setIBI(elapsedTime, Math.round(medianFilter(ibi)));
    });
  }

  /**
   * Low pass filter
   * @param {IBIData} ibiData
   * @param {number} windowSize
   * @param linearWeight
   */
  public static lowPassFilter(ibiData: IBIData, windowSize?: number, linearWeight?: boolean) {
    const lowPassFilter = new LowPassFilter();
    windowSize = windowSize || 5;
    linearWeight = linearWeight ? lowPassFilter.LinearWeightAverage : lowPassFilter.SimpleAverage;
    lowPassFilter.setLogic(linearWeight);
    lowPassFilter.setSamplingRange(windowSize);
    ibiData.getIBIDataMap().forEach((ibi, elapsedTime) => {
      lowPassFilter.putValue(ibi);
      ibiData.setIBI(elapsedTime, Math.round(lowPassFilter.getFilteredValue()));
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
