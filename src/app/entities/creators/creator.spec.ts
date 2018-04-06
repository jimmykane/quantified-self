import {CreatorInterface} from './creatorInterface';
import {Creator} from './creator';
import {Activity} from '../activities/activity';

describe('Creator', () => {

  let creator: CreatorInterface;

  beforeEach(() => {
    creator = new Creator();
  });

  it('should export correctly to JSON', () => {
    creator.name = 'name';
    creator.hwInfo = 'HWInfo';
    creator.swInfo = 'SWInfo';
    creator.serialNumber = 'SerialNumber';
    expect(creator.toJSON()).toEqual({
      name: 'name',
      serialNumber: 'SerialNumber',
      swInfo: 'SWInfo',
      hwInfo: 'HWInfo',
    });

  });
});
