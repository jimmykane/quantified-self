import {GeoLibAdapter} from './geolib.adapter';
import {DistanceSimple} from './distance/distance.geolib.simple.adapter';
import {DistanceVincenty} from './distance/distance.geolib.vincenty.adapter';
import {Point} from "../../points/point";
import {DataLatitudeDegrees} from "../../data/data.latitude-degrees";
import {DataLongitudeDegrees} from "../../data/data.longitude-degrees";

describe('GeoLibAdapter', function () {

  let geoLibAdapter: GeoLibAdapter;

  beforeEach(() => {
  });

  it('should instantiate a non simple distance adapter', function () {
    geoLibAdapter = new GeoLibAdapter();
    expect(geoLibAdapter.distanceAdapter instanceof DistanceVincenty).toBe(true);
  });

  it('should instantiate a simple distance adapter', function () {
    geoLibAdapter = new GeoLibAdapter(true);
    expect(geoLibAdapter.distanceAdapter instanceof DistanceSimple).toBe(true);
  });

  it('should get a correct distance for simple adapter', function () {
    geoLibAdapter = new GeoLibAdapter(true);

    const pointA = new Point(new Date());
    pointA.addData(new DataLatitudeDegrees(0));
    pointA.addData(new DataLongitudeDegrees(0));

    const pointB = new Point(new Date());
    pointB.addData(new DataLatitudeDegrees(1));
    pointB.addData(new DataLongitudeDegrees(1));

    expect(geoLibAdapter.getDistance([pointA, pointB])).toBe(157426);
  });


  it('should get a correct distance for simple adapter and changed accuracy', function () {
    geoLibAdapter = new GeoLibAdapter(true);

    const pointA = new Point(new Date());
    pointA.addData(new DataLatitudeDegrees(0));
    pointA.addData(new DataLongitudeDegrees(0));

    const pointB = new Point(new Date());
    pointB.addData(new DataLatitudeDegrees(1));
    pointB.addData(new DataLongitudeDegrees(1));

    expect(geoLibAdapter.getDistance([pointA, pointB], 20)).toBe(157420);
  });


  it('should get distance for simple adapter and changed precision but not have any effect', function () {
    geoLibAdapter = new GeoLibAdapter(true);

    const pointA = new Point(new Date());
    pointA.addData(new DataLatitudeDegrees(0));
    pointA.addData(new DataLongitudeDegrees(0));

    const pointB = new Point(new Date());
    pointB.addData(new DataLatitudeDegrees(1));
    pointB.addData(new DataLongitudeDegrees(1));

    expect(geoLibAdapter.getDistance([pointA, pointB], null, 100)).toBe(157426);
  });

  it('should get a correct distance for Vincety adapter', function () {
    geoLibAdapter = new GeoLibAdapter();

    const pointA = new Point(new Date());
    pointA.addData(new DataLatitudeDegrees(0));
    pointA.addData(new DataLongitudeDegrees(0));

    const pointB = new Point(new Date());
    pointB.addData(new DataLatitudeDegrees(1));
    pointB.addData(new DataLongitudeDegrees(1));

    expect(geoLibAdapter.getDistance([pointA, pointB])).toBe(156900);
  });

  it('should get a correct distance for Vincety adapter and changed accuracy', function () {
    geoLibAdapter = new GeoLibAdapter();

    const pointA = new Point(new Date());
    pointA.addData(new DataLatitudeDegrees(0));
    pointA.addData(new DataLongitudeDegrees(0));

    const pointB = new Point(new Date());
    pointB.addData(new DataLatitudeDegrees(1));
    pointB.addData(new DataLongitudeDegrees(1));

    expect(geoLibAdapter.getDistance([pointA, pointB], 2000)).toBe(156000);
  });

  it('should get a correct distance for Vincety adapter and changed precision', function () {
    geoLibAdapter = new GeoLibAdapter();

    const pointA = new Point(new Date());
    pointA.addData(new DataLatitudeDegrees(0));
    pointA.addData(new DataLongitudeDegrees(0));

    const pointB = new Point(new Date());
    pointB.addData(new DataLatitudeDegrees(1));
    pointB.addData(new DataLongitudeDegrees(1));

    expect(geoLibAdapter.getDistance([pointA, pointB], null, 2)).toBe(156899.57);
  });


  it('should get a correct distance for Vincety adapter with changed accuracy and changed precision', function () {
    geoLibAdapter = new GeoLibAdapter();

    const pointA = new Point(new Date());
    pointA.addData(new DataLatitudeDegrees(0));
    pointA.addData(new DataLongitudeDegrees(0));

    const pointB = new Point(new Date());
    pointB.addData(new DataLatitudeDegrees(1));
    pointB.addData(new DataLongitudeDegrees(1));

    expect(geoLibAdapter.getDistance([pointA, pointB], 2000, 5)).toBe(156899.56);
  });


});
