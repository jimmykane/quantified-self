import {CreatorInterface} from './creatorInterface';
import {Creator} from './creator';

describe('Creator', function () {

  let creator: CreatorInterface;

  beforeEach(() => {
    creator = new Creator();
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
