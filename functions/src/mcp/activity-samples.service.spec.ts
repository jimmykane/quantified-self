import { ActivityTypes, DataHeartRate, DataPower, DataCadence, DataAltitude, DataLatitudeDegrees, EventImporterJSON, FileType, Privacy } from '@sports-alliance/sports-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivitySampleCache, ACTIVITY_SAMPLE_CACHE_LIMITS } from './activity-sample-cache';
import { activitySampleResultBytes, ActivitySamplesCodec, ActivitySamplesDependencies, ActivitySamplesInput, buildActivitySampleDataset, MCP_ACTIVITY_SAMPLES_LIMITS, queryActivitySamples } from './activity-samples.service';

const caches: ActivitySampleCache[] = [];
afterEach(() => { caches.splice(0).forEach(cache => cache.clear()); });
function fixture(streams: Record<string, (number | null)[]> = { [DataHeartRate.type]: [100, null, 0, 140, 150] }) {
  let now = 1000000;
  const start = 1700000000000;
  const length = Math.max(1, ...Object.values(streams).map(values => values.length));
  const cache = new ActivitySampleCache(() => now);
  caches.push(cache);
  const deps: ActivitySamplesDependencies = {
    now: () => now, cache, activeOwner: vi.fn().mockResolvedValue(true),
    context: vi.fn().mockResolvedValue({identityFingerprint: 'identity', sourceFiles: [{path: 'private.fit', startDate: new Date(0)}],
      existingActivities: [{startDate: start, endDate: start + (length - 1) * 1000, type: ActivityTypes.Running, getStat: () => null}], targetExistingIndex: 0}),
    sourceVersions: vi.fn(async (_uid, _event, files) => files.map(file => ({...file, generation: '123'}))),
    loadSource: vi.fn().mockResolvedValue(Buffer.from('private original')), consumeParse: vi.fn().mockResolvedValue(undefined),
    parseSource: vi.fn(async () => EventImporterJSON.getEventFromJSON({
      name: 'Private title', srcFileType: FileType.FIT, description: 'private description', privacy: Privacy.Private,
      isMerge: false, startDate: start, endDate: start + (length - 1) * 1000, stats: {}, activities: [{
        name: 'Private device', startDate: start, endDate: start + (length - 1) * 1000, type: ActivityTypes.Running,
        powerMeter: false, trainer: false, stats: {}, streams, laps: [],
        creator: {name: 'Private device', serialNumber: 'serial', devices: []}, intensityZones: [], events: [],
      }],
    })),
  };
  const codec: ActivitySamplesCodec = {
    reference: (value, uid, connection) => { if (value !== 'ref' || uid !== 'u' || connection !== 'c') throw new Error('Invalid reference'); return {activityId: 'a', eventId: 'e'}; },
    encode: (value, uid, connection) => Buffer.from(JSON.stringify([uid, connection, value])).toString('base64url'),
    decode: (value, uid, connection) => { const [u, c, result] = JSON.parse(Buffer.from(value, 'base64url').toString()); if (u !== uid || c !== connection) throw new Error('Invalid cursor'); return result; },
  };
  const input: ActivitySamplesInput = {uid: 'u', connectionId: 'c', scopes: ['activity-details:read'], activityRef: 'ref', metrics: ['heart_rate'], limit: 2};
  return {deps, codec, input, advance: (ms: number) => { now += ms; }, run: (overrides: Partial<ActivitySamplesInput> = {}) => queryActivitySamples({...input, ...overrides}, deps, codec)};
}

describe('activity samples', () => {
  it('reconstructs three hours of aligned readings across pages, preserving zeros, gaps and the final second with one parse', async () => {
    const hr = Array.from({length: 10801}, (_, i) => i % 19 === 0 ? null : 90 + i % 90);
    const power = Array.from({length: 10799}, (_, i) => i % 50 ? 200 : 0);
    const f = fixture({[DataHeartRate.type]: hr, [DataPower.type]: power, [DataLatitudeDegrees.type]: Array(10801).fill(37)});
    const times: number[] = [], hearts: (number | null)[] = [], watts: (number | null)[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const result = await f.run({metrics: ['hr', 'watts'], limit: 2000, cursor});
      expect(result.range).toEqual({startOffsetSeconds: 0, endOffsetSeconds: 10801, totalSampleCount: 10801});
      expect(result.page.returnedSampleCount).toBe(result.elapsedTimeSeconds.length);
      expect(result.series.every(series => series.values.length === result.page.returnedSampleCount)).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/Private|private|serial|Latitude|sourceActivityKey|bucket/);
      times.push(...result.elapsedTimeSeconds); hearts.push(...result.series[0].values); watts.push(...result.series[1].values);
      cursor = result.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(6);
    expect(times).toEqual(Array.from({length: 10801}, (_, i) => i));
    expect(hearts).toEqual(hr); expect(watts).toEqual([...power, null, null]);
    expect(f.deps.loadSource).toHaveBeenCalledTimes(1); expect(f.deps.consumeParse).toHaveBeenCalledTimes(1);
    expect(f.deps.parseSource).toHaveBeenCalledTimes(1); expect(f.deps.context).toHaveBeenCalledTimes(12);
  });

  it('uses inclusive start/exclusive end, deduplicates aliases, and pads absent metrics with null', async () => {
    const f = fixture();
    const page = await f.run({metrics: ['hr', 'heart rate', 'power'], startOffsetSeconds: 1, endOffsetSeconds: 4, limit: 10});
    expect(page.elapsedTimeSeconds).toEqual([1, 2, 3]);
    expect(page.series).toEqual([
      {metric: 'heart_rate', canonicalUnit: 'beats_per_minute', sourceSampleCount: 5, missingSampleCount: 1, values: [null, 0, 140]},
      {metric: 'power', canonicalUnit: 'watts', sourceSampleCount: 0, missingSampleCount: 3, values: [null, null, null]},
    ]);
    expect(page.nextCursor).toBeNull();
    expect((await f.run({startOffsetSeconds: 20})).page).toEqual({startOffsetSeconds: 5, endOffsetSeconds: 5, returnedSampleCount: 0});
    expect((await f.run({metrics: ['power']})).range.totalSampleCount).toBe(0);
  });

  it('preserves non-finite and missing values as null and clamps ranges to available data', async () => {
    const f = fixture({[DataHeartRate.type]: [NaN, Infinity, -Infinity, 0]});
    expect((await f.run({endOffsetSeconds: 100, limit: 100})).series[0].values).toEqual([null, null, null, 0]);
  });

  it.each([
    {scopes: []}, {metrics: []}, {metrics: ['latitude']}, {metrics: ['hr', 'power', 'speed', 'distance', 'cadence']},
    {limit: 0}, {limit: 10001}, {startOffsetSeconds: -1}, {endOffsetSeconds: 0}, {startOffsetSeconds: 2, endOffsetSeconds: 1}, {cursor: 'x'.repeat(513)},
  ])('rejects invalid input before reads: %j', async invalid => {
    const f = fixture(); await expect(f.run(invalid)).rejects.toMatchObject({code: 'invalid_request'});
    expect(f.deps.context).not.toHaveBeenCalled(); expect(f.deps.loadSource).not.toHaveBeenCalled();
  });

  it.each([{metrics: ['power']}, {limit: 3}, {startOffsetSeconds: 1}, {endOffsetSeconds: 4}])('binds continuation to the complete query: %j', async changes => {
    const f = fixture(); const first = await f.run();
    await expect(f.run({...changes, cursor: first.nextCursor!})).rejects.toMatchObject({code: 'invalid_request'});
    expect(f.deps.loadSource).toHaveBeenCalledTimes(1);
  });

  it('expires cursors but permits a cold cache to reparse and safely continue', async () => {
    const f = fixture(); const first = await f.run();
    f.deps.cache.clear();
    const second = await f.run({cursor: first.nextCursor!});
    expect(second.elapsedTimeSeconds).toEqual([2, 3]); expect(f.deps.consumeParse).toHaveBeenCalledTimes(2);
    f.advance(MCP_ACTIVITY_SAMPLES_LIMITS.cursorTtlMs);
    await expect(f.run({cursor: second.nextCursor!})).rejects.toMatchObject({code: 'invalid_request'});
  });

  it('rejects changed parser output when continuing on a cold instance', async () => {
    const hr = [1, 2, 3, 4, 5]; const f = fixture({[DataHeartRate.type]: hr}); const first = await f.run();
    f.deps.cache.clear(); hr[0] = 999;
    await expect(f.run({cursor: first.nextCursor!})).rejects.toThrow('sample data changed');
  });

  it('checks ownership, object existence and source revisions even for warm cached pages', async () => {
    const f = fixture(); const first = await f.run();
    vi.mocked(f.deps.activeOwner).mockResolvedValueOnce(false);
    await expect(f.run({cursor: first.nextCursor!})).rejects.toMatchObject({code: 'detail_not_available'});
    vi.mocked(f.deps.sourceVersions).mockRejectedValueOnce(new Error('deleted'));
    await expect(f.run({cursor: first.nextCursor!})).rejects.toThrow('deleted');
    vi.mocked(f.deps.sourceVersions).mockImplementation(async (_u, _e, files) => files.map(file => ({...file, generation: '456'})));
    await expect(f.run({cursor: first.nextCursor!})).rejects.toThrow('source changed');
    expect(f.deps.loadSource).toHaveBeenCalledTimes(1);
  });

  it('rejects a source changed or owner deleted during the read', async () => {
    const f = fixture();
    vi.mocked(f.deps.sourceVersions).mockResolvedValueOnce([{path: 'private.fit', startDate: new Date(0), generation: '123'}])
      .mockResolvedValueOnce([{path: 'private.fit', startDate: new Date(0), generation: '456'}]);
    await expect(f.run()).rejects.toThrow('source changed during');
    vi.mocked(f.deps.activeOwner).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(f.run()).rejects.toMatchObject({code: 'detail_not_available'});
  });

  it('automatically reduces expensive pages to fit the byte bound without losing rows', async () => {
    const values = Array.from({length: 10001}, (_, i) => (i + 1) * (Math.PI * 1e100));
    const f = fixture({[DataHeartRate.type]: values, [DataPower.type]: values, [DataCadence.type]: values, [DataAltitude.type]: values});
    let cursor: string | undefined; const times: number[] = [];
    do {
      const result = await f.run({metrics: ['hr', 'power', 'cadence', 'altitude'], limit: 10000, cursor});
      expect(activitySampleResultBytes(result)).toBeLessThanOrEqual(MCP_ACTIVITY_SAMPLES_LIMITS.responseBytes);
      expect(result.page.returnedSampleCount).toBeLessThan(10000);
      times.push(...result.elapsedTimeSeconds); cursor = result.nextCursor ?? undefined;
    } while (cursor);
    expect(times).toEqual(Array.from({length: 10001}, (_, i) => i));
  });

  it('retains the shared parser selected-sample bound', async () => {
    const f = fixture({[DataHeartRate.type]: Array(250001).fill(100)});
    await expect(f.run()).rejects.toMatchObject({code: 'query_too_large'});
  });

  it('parses a real GPX source using the production parser', async () => {
    const start = Date.parse('2026-07-01T08:00:00Z');
    const context = {sourceFiles: [{path: 'original.gpx', startDate: new Date(start)}], existingActivities: [{startDate: start, endDate: start + 2000, type: ActivityTypes.Running, getStat: () => null}], targetExistingIndex: 0};
    const gpx = '<?xml version="1.0"?><gpx version="1.1" creator="fixture" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><type>Running</type><trkseg>' + [100, 120, 140].map((hr, i) => `<trkpt lat="60.1" lon="24.${1000 + i}"><time>2026-07-01T08:00:0${i}Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`).join('') + '</trkseg></trk></gpx>';
    const result = await buildActivitySampleDataset(context, ['heart_rate'], {loadSource: async () => Buffer.from(gpx)});
    expect(result.series[0].values).toEqual([100, 120, 140]);
  });
});

describe('activity sample cache', () => {
  const data = {activityType: 'Running', length: 1, digest: 'hash', series: [{metric: 'hr', canonicalUnit: 'bpm', values: [1]}]};
  it('coalesces concurrent identical parses and bounds concurrent different parses', async () => {
    const f = fixture(); let release!: () => void;
    const build = vi.fn(async () => { await new Promise<void>(resolve => { release = resolve; }); return data; });
    const a = f.deps.cache.load('a', build), same = f.deps.cache.load('a', build);
    const b = f.deps.cache.load('b', async () => data);
    await expect(f.deps.cache.load('c', async () => data)).rejects.toThrow('busy');
    release(); expect(await a).toBe(await same); await b; expect(build).toHaveBeenCalledTimes(1);
  });
  it('does not repopulate after clear while a build is pending', async () => {
    const f = fixture(); let release!: (value: typeof data) => void;
    const pending = f.deps.cache.load('a', () => new Promise(resolve => { release = resolve; }));
    await Promise.resolve(); f.deps.cache.clear(); release(data); await pending;
    const build = vi.fn(async () => data); await f.deps.cache.load('a', build);
    expect(build).toHaveBeenCalledTimes(1);
  });
  it('expires private arrays even without another request and enforces the aggregate memory bound', async () => {
    const f = fixture(); const cache = f.deps.cache;
    const large = {...data, series: [{...data.series[0], values: Array(250000).fill(Math.PI)}]};
    const build = vi.fn(async () => large);
    // Each item fits the per-entry bound; three exceed the aggregate bound.
    await cache.load('a', build); await cache.load('b', build); await cache.load('c', build);
    await cache.load('a', build); expect(build).toHaveBeenCalledTimes(4);
    cache.clear(); vi.useFakeTimers();
    try {
      await cache.load('small', async () => data);
      vi.advanceTimersByTime(ACTIVITY_SAMPLE_CACHE_LIMITS.ttlMs);
      const again = vi.fn(async () => data); await cache.load('small', again); expect(again).toHaveBeenCalledTimes(1);
    } finally { cache.clear(); vi.useRealTimers(); }
  });
  it('expires entries, evicts least recently used entries, and never caches failures or oversized datasets', async () => {
    const f = fixture(); const build = vi.fn(async () => data);
    await expect(f.deps.cache.load('a', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    await f.deps.cache.load('a', build); await f.deps.cache.load('a', build); expect(build).toHaveBeenCalledTimes(1);
    f.advance(ACTIVITY_SAMPLE_CACHE_LIMITS.ttlMs); await f.deps.cache.load('a', build); expect(build).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 8; i++) await f.deps.cache.load(String(i), build);
    await f.deps.cache.load('a', build); expect(build).toHaveBeenCalledTimes(11);
    const large = vi.fn(async () => ({...data, series: [{...data.series[0], values: Array(600000).fill(1)}]}));
    await f.deps.cache.load('large', large); await f.deps.cache.load('large', large); expect(large).toHaveBeenCalledTimes(2);
  });
});
