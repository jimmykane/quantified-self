import {CreatorInterface} from './creatorInterface';
import {Creator} from './creator';
import {Activity} from "../activities/activity";
import {ActivityInterface} from "../activities/activity.interface";

describe('Creator', function () {

  let creator: CreatorInterface;

  beforeEach(() => {
    creator = new Creator();
  });

  it('should set an activity', function () {
    const activty = new Activity();
    creator.setActivity(activty);
    expect(creator.getActivity()).toEqual(activty);
  });

  it('should export correctly to JSON', function () {
    creator.setName('name');
    creator.setHWInfo('HWInfo');
    creator.setSWInfo('SWInfo');
    creator.setSerialNumber('SerialNumber');
    expect(creator.toJSON()).toEqual({
      name: 'name',
      serialNumber: 'SerialNumber',
      swInfo: 'SWInfo',
      hwInfo: 'HWInfo',
    });

  });
});
