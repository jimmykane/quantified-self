/**
 * Collection of filters parsers and converters for IBI (R-R) data
 */
import {IBIData} from './data.ibi';

export class IBIFilters {

  public static passFilter(ibiData: IBIData, passLimit: number, lowPass: boolean) {
    ibiData.getIBIData().forEach((value, key, map) => {
      if (value < passLimit && lowPass) {
        ibiData.getIBIData().delete(key);
      } else if (value > passLimit && !lowPass) {
        ibiData.getIBIData().delete(key)
      }
    });
  }

  public static filterOnStepAverage(ibiData: IBIData, step?: number) {
    step = step || 2;
    const bufferMap = new Map();
    ibiData.getIBIData().forEach((ibi, elapsedTime) => {
      bufferMap.set(elapsedTime, ibi);
      if (bufferMap.size >= step) {
        // Find the value average
        const avgValue = Array.from(bufferMap.values()).reduce((total, value) => {
          return total + value;
        }) / bufferMap.size ;
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
