import {EventImporterSuuntoJSON} from './importers/importer.suunto.json';
import {EventImporterJSON} from './importers/importer.json';
import {Event} from '../event';
import {PointInterface} from "../../points/point.interface";
import {LapInterface} from "../../laps/lap.interface";

const example1 = require('../../../../../samples/track_examples/example.json');
const example2 = require('../../../../../samples/track_examples/suunto.json');

describe('EventAdapters', () => {

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
    const event1 = EventImporterJSON.getFromJSONString(JSON.stringify(example1));
    const event2 = EventImporterSuuntoJSON.getFromJSONString(JSON.stringify(example2));

    // This is clearly a hack
    event2.name = event1.name;
    event1.setID('123');
    event1.getActivities().map((activity) => {
      activity.setID('123');
      delete activity.summary.avgHR;
      delete activity.summary.maxHR;
      delete activity.summary.minHR;
      delete activity.summary.minPower;
      delete activity.summary.avgPower;
      delete activity.summary.maxPower;
      delete activity.summary.minCadence;
      delete activity.summary.maxCadence;
      delete activity.summary.avgCadence;
      delete activity.summary.maxSpeed;
      delete activity.summary.minSpeed;
      delete activity.summary.avgSpeed;
      delete activity.summary.minVerticalSpeed;
      delete activity.summary.maxVerticalSpeed;
      delete activity.summary.avgVerticalSpeed;
      delete activity.summary.minTemperature;
      delete activity.summary.maxTemperature;
      delete activity.summary.avgTemperature;
      delete activity.summary.weather;
      delete activity.summary.geoLocationInfo;
      activity.getLaps().sort((lapA: LapInterface, lapB: LapInterface) => {
        return lapA.startDate.getTime() - lapB.startDate.getTime();
      });
    });
    event2.setID('123');
    event2.getActivities().map((activity) => {
      activity.setID('123')
    });
    expect(event1).toEqual(event2);
  });

});
