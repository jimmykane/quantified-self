import {EventImporterJSON} from './importer.json';
import {Event} from '../../event';
const example1  = require('../../../../../../samples/track_examples/json_example.json');
describe('EventImporterJSON', () => {

  beforeEach(() => {
  });

  it('should be able to decode an get an event from an example json', () => {
    expect(EventImporterJSON.getFromJSONString(  JSON.stringify(example1) ) instanceof Event).toBe(true);
  });

});
