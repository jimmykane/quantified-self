import {Event} from '../../event';
import {EventImporterSuuntoJSON} from './importer.suunto.json';
const example1  = require('../../../../../../samples/track_examples/sjson.json');

describe('EventImporterSuuntoJSON', () => {

  beforeEach(() => {
  });

  it('should be able to decode an get an event from an example json', () => {
    expect(EventImporterSuuntoJSON.getFromJSONString(  JSON.stringify(example1) ) instanceof Event).toBe(true);
  });

});
