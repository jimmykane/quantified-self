import {EventImporterSuuntoJSON} from './importers/importer.suunto.json';
import {EventImporterJSON} from './importers/importer.json';
import {Event} from '../event';

const example1 = require('../../../../../samples/track_examples/json_example.json');
const example2 = require('../../../../../samples/track_examples/sjson.json');

describe('EventImporters', () => {

  beforeEach(() => {
  });

  it('should be able to decode json', () => {
    expect(EventImporterJSON.getFromJSONString(JSON.stringify(example1)) instanceof Event).toBe(true);
  });

  it('should be able to decode from s', () => {
    expect(EventImporterSuuntoJSON.getFromJSONString(JSON.stringify(example2)) instanceof Event).toBe(true);
  });

  it('should be able to decode from s and then create a json that will create a same object', () => {
    expect(EventImporterJSON.getFromJSONString(
      JSON.stringify(
        EventImporterSuuntoJSON.getFromJSONString(
          JSON.stringify(example2)
        )
      )
    ) instanceof Event).toBe(true);
  });

  it('should be get the same result from any adapter', () => {
    // const event1 = EventImporterJSON.getFromJSONString(JSON.stringify(example1));
    // const event2 = EventImporterSuuntoJSON.getFromJSONString(JSON.stringify(example2));
    // // This is clearly a hack
    // // @todo add req args to contructor
    // event2.name = event1.name;
    // // Spy on dynamic methods
    // event1.setID('123');
    // event1.getActivities().map((activity) => {
    //   activity.setID('123')
    //
    // });
    // event2.setID('123');
    // event2.getActivities().map((activity) => {
    //   activity.setID('123')
    // });
    // expect(event1).toEqual(event2);
  });

});
