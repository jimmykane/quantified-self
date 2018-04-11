import {DataInterface} from './data.interface';
import {DataTemperature} from './data.temperature';
import {Point} from '../points/point';

describe('Data', () => {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataTemperature(60);
  });

});
