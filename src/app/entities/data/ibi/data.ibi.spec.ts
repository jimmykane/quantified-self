import {IBIData} from './data.ibi';

describe('Data IBI', function () {

  let ibiData: IBIData;

  beforeEach(() => {
    ibiData = new IBIData([600, 700, 800, 900]);
  });

  it('should get the correct data map', function () {
    const expectedResult = new Map<number, number>();
    expectedResult.set(600, 600);
    expectedResult.set(1300, 700);
    expectedResult.set(2100, 800);
    expectedResult.set(3000, 900);
    expect(ibiData.getIBIDataMap()).toEqual(expectedResult);
  });

  it('should convert correctly to heart rate by Math.Round', function () {
    const expectedResult = new Map<number, number>();
    expectedResult.set(600, Math.round(60000 / 600));
    expectedResult.set(1300, Math.round(60000 / 700));
    expectedResult.set(2100, Math.round(60000 / 800));
    expectedResult.set(3000, Math.round(60000 / 900));
    expect(ibiData.getAsBPM()).toEqual(expectedResult);
  });

  it('should filter all bpm above 80', function () {
    const expectedResult = new Map<number, number>();
    expectedResult.set(600, Math.round(60000 / 600));
    expectedResult.set(1300, Math.round(60000 / 700));
    expectedResult.set(2100, Math.round(60000 / 800));
    expectedResult.set(3000, Math.round(60000 / 900));
    expect(ibiData.getAsBPM()).toEqual(expectedResult);
  });

  it('should remove all bpm above 80', function () {
    const expectedResult = new Map<number, number>();
    expectedResult.set(2100, Math.round(60000 / 800)); // 75
    expectedResult.set(3000, Math.round(60000 / 900)); // 66
    ibiData.highLimitBPMFilter(80);
    expect(ibiData.getAsBPM()).toEqual(expectedResult);
  });

  it('should remove all bpm below 80', function () {
    const expectedResult = new Map<number, number>();
    ibiData.lowLimitBPMFilter(80);
    expectedResult.set(600, Math.round(60000 / 600)); // 100
    expectedResult.set(1300, Math.round(60000 / 700)); // 85
    expect(ibiData.getAsBPM()).toEqual(expectedResult);
  });

  it('should export correctly to JSON', function () {
    expect(ibiData.toJSON()).toEqual([600, 700, 800, 900]);
  });

});
