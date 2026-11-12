import { describe, expect, it, vi } from 'vitest';
import { XmlDOMParser } from './xml-parser';
import { RouteImporterGPX } from '@sports-alliance/sports-lib';
import { parseActivityFilePayload } from './activity-file-parser';

const start = '2026-01-01T10:00:00Z';
const end = '2026-01-01T10:01:00Z';
const gpx = `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="Synthetic test">
  <trk><name>Example track</name><trkseg>
    <trkpt lat="37" lon="23"><ele>10</ele><time>${start}</time></trkpt>
    <trkpt lat="37.001" lon="23.001"><ele>12</ele><time>${end}</time></trkpt>
  </trkseg></trk>
</gpx>`;
const tcx = `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Running"><Id>${start}</Id><Lap StartTime="${start}">
    <TotalTimeSeconds>60</TotalTimeSeconds><DistanceMeters>100</DistanceMeters><Calories>7</Calories>
    <Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod><Track>
      <Trackpoint><Time>${start}</Time><DistanceMeters>0</DistanceMeters></Trackpoint>
      <Trackpoint><Time>${end}</Time><DistanceMeters>100</DistanceMeters></Trackpoint>
    </Track></Lap></Activity></Activities>
</TrainingCenterDatabase>`;
const route = `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="Synthetic test">
  <rte><name>Example route</name><rtept lat="37" lon="23"/><rtept lat="37.001" lon="23.001"/></rte>
</gpx>`;

describe('maintained XML parser with real Sports Lib importers', () => {
  it.each([['gpx', gpx], ['tcx', tcx]])('preserves a valid %s recording and its time bounds', async (extension, xml) => {
    const event = await parseActivityFilePayload(Buffer.from(xml), extension);
    expect(event.getActivities()).toHaveLength(1);
    expect(event.startDate.toISOString()).toBe(new Date(start).toISOString());
    expect(event.endDate.toISOString()).toBe(new Date(end).toISOString());
  });

  it('preserves GPX routes through the injected parser', async () => {
    const result = await RouteImporterGPX.getFromString(route, XmlDOMParser);
    expect(result.getRoutes()).toHaveLength(1);
    expect(result.getRoutes()[0].name).toBe('Example route');
  });

  it.each([['gpx', gpx], ['tcx', tcx]])('rejects a second XML root in %s before producing an activity', async (extension, xml) => {
    await expect(parseActivityFilePayload(Buffer.from(`${xml}<injected/>`), extension)).rejects.toThrow('Invalid XML document');
  });

  it('rejects a second XML root before producing a route', async () => {
    await expect(RouteImporterGPX.getFromString(`${route}<injected/>`, XmlDOMParser)).rejects.toThrow('Invalid XML document');
  });

  it.each([
    '<gpx private="original-file-canary" private="other"/>',
    '<gpx><metadata>original-file-canary</gpx>',
    'original-file-canary',
  ])('rejects malformed XML without logging its content %#', xml => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    try {
      let failure: unknown;
      try { new XmlDOMParser().parseFromString(xml); } catch (caught) { failure = caught; }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe('Invalid XML document');
      expect(failure).not.toHaveProperty('cause');
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
