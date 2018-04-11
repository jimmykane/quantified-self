import {DataInterface, UnitSystem} from './data.interface';
import {DataTemperature} from './data.temperature';
import {Point} from '../points/point';

describe('Data', () => {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataTemperature(60);
  });

  it('should get the type correctly', () => {
    expect(data.getType()).toBe('Temperature');
  });

  it('should get the value correctly', () => {
    expect(data.getValue()).toBe(60);
  });


  it('should get the unit system correctly', () => {
    expect(data.getUnitSystem()).toBe(UnitSystem.Metric);
  });


  it('should export correctly to JSON', () => {
    expect(data.toJSON()).toEqual({
      type: 'Temperature',
      value: 60,
      unitSystem: UnitSystem.Metric,
    });
  });

});
