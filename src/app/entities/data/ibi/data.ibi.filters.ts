/**
 * Collection of filters parsers and converters for IBI (R-R) data
 */
import {IBIData} from './data.ibi';

export class IBIFilters {

  public static passFilter(ibiData: IBIData, passLimit: number, lowPass: boolean) {
    debugger;
    ibiData.getIBIData().forEach((value, key, map) => {
      if (value < passLimit && lowPass) {
        ibiData.getIBIData().delete(key);
      } else if (value > passLimit && !lowPass) {
        ibiData.getIBIData().delete(key)
      }
    });
  }

  // public static filterHRByStepAVGBuffer(hr: Map<number, number>, step?: number): Map<number, number> {
  //   step = step || 2;
  //   const filteredHRMap = new Map();
  //   let buffer = [];
  //   let startTime;
  //   hr.forEach((value, key, map) => {
  //     buffer.push(value);
  //     if (!startTime) {
  //       startTime = key;
  //     }
  //     if (buffer.length >= step) {
  //       filteredHRMap.set(startTime + ((key - startTime) / 2), buffer.reduce((total, hrValue) => {
  //         return total + hrValue;
  //       }) / buffer.length);
  //       buffer = [];
  //       startTime = null;
  //     }
  //   });
  //   return filteredHRMap;
  // }

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
