export class HRFilters {

  /**
   * Low pass filter. Removes all hr values above limit
   * @param {Map<number, number>} hr
   * @param {number} lowPassHRLimit
   * @return {number | undefined}
   */
  public static lowPassBPMFilter(hr: Map<number, number>, lowPassHRLimit?: number): Map<number, number>  {
    lowPassHRLimit = lowPassHRLimit || 220; // Vallencel
    const filteredHR = new Map();
    hr.forEach((value, key, map) => {
      if (value < lowPassHRLimit) {
        filteredHR.set(key, value);
      }
    });
    return filteredHR;
  }

  /**
   * High pass filter.  Removes all hr values below limit
   * @param {Map<number, number>} hr
   * @param {number} highPassHRLimit
   * @return {number}
   */
  public static highPassBPMFilter(hr: Map<number, number>, highPassHRLimit?: number): Map<number, number>  {
    highPassHRLimit = highPassHRLimit || 40; // Magic number
    const filteredHR = new Map();
    hr.forEach((value, key, map) => {
      if (value > highPassHRLimit) {
        filteredHR.set(key, value);
      }
    });
    return filteredHR;
  }

  public static filterHRByStepAVGBuffer(hr: Map<number, number>, step?: number): Map<number, number> {
    step = step || 1;
    const filteredHRMap = new Map();
    let buffer = [];
    hr.forEach((value, key, map) => {
      buffer.push(value);
      if (buffer.length >= step) {
        filteredHRMap.set(key, buffer.reduce((total, hrValue) => {
          return total + hrValue;
        }) / buffer.length);
        buffer = [];
      }
    });
    return filteredHRMap;
  }

  /**
   * Converts the RR array to HR instantaneus (what user sees)
   * @param rrData
   * @return {any}
   */
  public static convertRRtoHR(rrData): Map<number, number> {
    let totalTime = 0;
    return rrData.reduce((hrDataMap: Map<number, number>, rr) => {
      totalTime += rr;
      hrDataMap.set(totalTime, Math.round(60000 / rr));
      return hrDataMap;
    }, new Map());
  }

  /**
   * Returns an Map of elapsed time and HR from RR data
   * @param rr
   * @param {number} sampleRateInSeconds
   * @return {number[]}
   */
  public static getHRFromRR(rr, sampleRateInSeconds?: number): Map<number, number> {
    sampleRateInSeconds = sampleRateInSeconds || 10; // Use any second number
    const limit = sampleRateInSeconds * 1000;
    let totalTime = 0;
    let rrBuffer = [];
    return rr.reduce((hr, d) => {
      // add it to the buffer
      rrBuffer.push(d);
      // Increase total time
      totalTime += d;
      // Check if buffer is full
      const time = rrBuffer.reduce((a, b) => a + b, 0); // gets the sum of the buffer [300+600 etc]
      if (time >= limit) {
        hr.set(totalTime, rrBuffer.length * 60 / (time / 1000)); // convert to bpm
        rrBuffer = [];
      }
      return hr;
    }, new Map());
  }
}
