import {IntensityZones} from './intensity-zone';

describe('Zone', function () {

  let zones: IntensityZones;

  beforeEach(() => {
    zones = new IntensityZones();
  });

  it('should export correctly to JSON', function () {
    zones.zone1Duration = 0;
    zones.zone2LowerLimit = 1;
    zones.zone2Duration = 2;
    zones.zone3LowerLimit = 3;
    zones.zone3Duration = 4;
    zones.zone4LowerLimit = 5;
    zones.zone4Duration = 6;
    zones.zone5LowerLimit = 7;
    zones.zone5Duration = 8;
    expect(zones.toJSON()).toEqual({
      'zone1Duration': 0,
      'zone2Duration': 2,
      'zone2LowerLimit': 1,
      'zone3Duration': 4,
      'zone3LowerLimit': 3,
      'zone4Duration': 6,
      'zone4LowerLimit': 5,
      'zone5Duration': 8,
      'zone5LowerLimit': 7
    });
  });

});
