import {EventImporterSuuntoJSON} from './importers/suunto/importer.suunto.json';
import {EventImporterJSON} from './importers/importer.json';
import {Event} from '../event';
import {EventImporterTCX} from './importers/importer.tcx';

const json = require('../../../../../samples/json/app.json');
const suuntoJSON = require('../../../../../samples/suunto/suunto.json');
const movescountTCXJSON = require('../../../../../samples/tcx/movescount.tcx.json');
const polarTCXJSON = require('../../../../../samples/tcx/polar.tcx.json');
const garminTCXJSON = require('../../../../../samples/tcx/garmin.tcx.json');

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

  it('should be able to decode tcx from Movescount', () => {
    expect(EventImporterTCX.getFromXML((new DOMParser()).parseFromString(movescountTCXJSON.tcx, 'application/xml')) instanceof Event).toBe(true);
  });

  it('should be able to decode tcx from Polar', () => {
    expect(EventImporterTCX.getFromXML((new DOMParser()).parseFromString(polarTCXJSON.tcx, 'application/xml')) instanceof Event).toBe(true);
  });

  it('should be able to decode tcx from Garmin', () => {
    expect(EventImporterTCX.getFromXML((new DOMParser()).parseFromString(garminTCXJSON.tcx, 'application/xml')) instanceof Event).toBe(true);
  });

  it('should import and export correctly from Suunto adapter', () => {
    // First get it from adapter 1
    const event1 = EventImporterSuuntoJSON.getFromJSONString(JSON.stringify(suuntoJSON));
    const event2 = EventImporterJSON.getFromJSONString(JSON.stringify(event1));

    event1.name = event2.name;
    expect(event1).toEqual(event2);
  });
});
