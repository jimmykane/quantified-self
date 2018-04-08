import {EventImporterSuuntoJSON} from './importers/suunto/importer.suunto.json';
import {EventImporterJSON} from './importers/importer.json';
import {Event} from '../event';
import {EventImporterTCX} from './importers/importer.tcx';

const json = require('../../../../../samples/example.json');
const suuntoJSON = require('../../../../../samples/suunto.json');
const tcxJSON = require('../../../../../samples/movescount_tcx.json');

describe('EventAdapters', () => {

  beforeEach(() => {

  });

  it('should be able to decode json', () => {
    expect(EventImporterJSON.getFromJSONString(JSON.stringify(json)) instanceof Event).toBe(true);
  });

  it('should be able to decode from s', () => {
    expect(EventImporterSuuntoJSON.getFromJSONString(JSON.stringify(suuntoJSON)) instanceof Event).toBe(true);
  });

  it('should be able to decode from s and then create a json that will create a same object', () => {
    expect(EventImporterJSON.getFromJSONString(
      JSON.stringify(
        EventImporterSuuntoJSON.getFromJSONString(
          JSON.stringify(suuntoJSON)
        )
      )
    ) instanceof Event).toBe(true);
  });

  it('should be able to decode tcx', () => {
    EventImporterTCX.getFromXML((new DOMParser()).parseFromString(tcxJSON.tcx, 'application/xml'));
  });


  it('should import and export correctly from Suunto adapter', () => {
    // First get it from adapter 1
    const event1 = EventImporterSuuntoJSON.getFromJSONString(JSON.stringify(suuntoJSON));
    const event2 = EventImporterJSON.getFromJSONString(JSON.stringify(event1));

    event1.name = event2.name;
    expect(event1).toEqual(event2);
  });
});
