import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  ActivityTypes, DataAltitude, DataDistance, DataHeartRate, DataPower, DataSpeed, DataStrydDistance, EventImporterJSON,
  DistanceUnits, PaceUnits, SpeedUnits, SwimPaceUnits, XAxisTypes,
} from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
import {
  buildEventChartPanels, buildEventChartPanelsFromSnapshot, canConnectEventChartPoints,
  createEventChartPanelBuildSnapshot, collectEventChartPanelBuildSnapshotTransferables, eventChartSeriesToPoints,
  type BuildEventChartPanelsInput,
  type EventChartPanelBuildSnapshotInput,
  type EventChartPanelWorkerRequest, type EventChartPanelWorkerResponse,
} from './event-echarts-data.helper';

// Use the same esbuild version as Angular's worker compiler, without loading Angular.
const requireBuildTool = createRequire(createRequire(import.meta.url).resolve('@angular/build/package.json'));
const { build } = requireBuildTool('esbuild') as typeof import('esbuild');
let workerCode: string;
let bundle: Awaited<ReturnType<typeof build>>;

beforeAll(async () => {
  bundle = await build({
    entryPoints: ['src/app/workers/event-chart-panels.worker.ts'],
    bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022',
    minify: true, metafile: true, tsconfig: 'src/tsconfig.app.json',
    outdir: resolve('tmp/event-chart-worker-test'), write: false,
  });
  workerCode = bundle.outputFiles![0].text;
});

function snapshot(swimming: boolean, imperial: boolean, xAxisType: XAxisTypes): EventChartPanelBuildSnapshotInput {
  const startTimeMs = Date.UTC(2026, 0, 1);
  return {
    selectedActivities: [{
      id: 'fixture', activityName: 'Fixture', activityType: swimming ? ActivityTypes.Swimming : ActivityTypes.Running,
      startTimeMs, intensityZones: [],
      streams: [
        { type: XAxisTypes.Time, values: new Float64Array([0, 1, 2, 3]) },
        { type: DataPower.type, values: new Float64Array([0, 100, NaN, 300]) },
        { type: DataHeartRate.type, values: new Float64Array([120, 121, 122, 123]) },
        { type: DataSpeed.type, values: new Float64Array([2.5, 3, 3.5, 0]) },
        { type: DataDistance.type, values: new Float64Array([0, NaN, 6.5, 6.5]) },
        { type: DataAltitude.type, values: new Float64Array([10, 11, 12, 13]) },
      ],
    }],
    xAxisType, showAllData: true, dataTypesToUse: [DataPower.type, DataHeartRate.type, DataSpeed.type],
    userUnitSettings: {
      ...getDefaultUserUnitSettings(),
      ...(imperial ? {
        distanceUnits: DistanceUnits.Miles,
        speedUnits: [SpeedUnits.MilesPerHour], paceUnits: [PaceUnits.MinutesPerMile],
        swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard],
      } : {}),
    },
    zoneColors: {},
  };
}

function worker() {
  let receive: (event: { data: EventChartPanelWorkerRequest }) => void;
  const messages: Array<{ response: EventChartPanelWorkerResponse; transferables: Transferable[] }> = [];
  runInNewContext(workerCode, {
    Float64Array, Uint32Array, ArrayBuffer, Date,
    addEventListener: (name: string, callback: typeof receive) => {
      expect(name).toBe('message'); receive = callback;
    },
    postMessage: (response: EventChartPanelWorkerResponse, transferables: Transferable[] = []) => {
      messages.push({ response: structuredClone(response, { transfer: transferables }), transferables });
    },
  }, { timeout: 5000 });
  return { send: (data: EventChartPanelWorkerRequest) => receive({ data }), messages };
}

describe('compiled event chart worker', () => {
  it('emits one worker and excludes all file adapters and parser chunks', () => {
    expect(bundle.outputFiles).toHaveLength(1);
    expect(Object.keys(bundle.metafile!.inputs).filter(path =>
      /fit-file-parser|\/events\/adapters\/|\/routes\/adapters\/|sports-lib\/lib\/esm\/index\.js$/.test(path))).toEqual([]);
  });

  it.each([
    [false, false, XAxisTypes.Duration], [false, true, XAxisTypes.Distance],
    [false, false, XAxisTypes.Time], [true, false, XAxisTypes.Duration], [true, true, XAxisTypes.Distance],
  ])('matches the synchronous builder for swimming=%s, imperial=%s, axis=%s', (swimming, imperial, axis) => {
    const input = snapshot(swimming as boolean, imperial as boolean, axis as XAxisTypes);
    const expected = buildEventChartPanelsFromSnapshot(input);
    expect(expected.length).toBeGreaterThan(0);
    const instance = worker();
    instance.send({ requestID: 42, input });
    const { response, transferables } = instance.messages[0];
    expect(response.requestID).toBe(42);
    if ('error' in response) throw new Error(response.error);
    // Compare in one realm without JSON's loss of typed arrays, NaN or undefined fields.
    expect(response.panels).toStrictEqual(structuredClone(expected));
    const hr = response.panels.find(panel => panel.dataType === DataHeartRate.type)!.series[0];
    const seconds = axis === XAxisTypes.Distance ? [0, 2, 3] : [0, 1, 2, 3];
    const start = input.selectedActivities[0].startTimeMs;
    expect(Array.from(hr.timeValues)).toEqual(seconds.map(second => start + second * 1000));
    expect(Array.from(hr.lineValues).filter((_, index) => index % 2 === 0)).toEqual(
      axis === XAxisTypes.Distance ? [0, 6.5, 6.5]
        : axis === XAxisTypes.Time ? seconds.map(second => start + second * 1000) : seconds,
    );
    expect(transferables.length).toBeGreaterThan(0);
    expect(new Set(transferables).size).toBe(transferables.length);
    expect(transferables).toHaveLength(expected.flatMap(panel => panel.series).reduce((count, series) =>
      count + [series.lineValues, series.timeValues, series.gradeColorValues, series.lineSegmentIds]
        .filter(values => values?.byteLength > 0).length, 0));
    expect(transferables.every(buffer => buffer instanceof ArrayBuffer && buffer.byteLength === 0)).toBe(true);
  });

  it.each(['continuous', 'detect', 'custom'] as const)('transfers the saved %s policy and display segment IDs', mode => {
    const input = snapshot(false, false, XAxisTypes.Duration);
    input.lineContinuity = { mode, maxGapSeconds: 1 };
    const instance = worker();
    instance.send({ requestID: 17, input });
    const response = instance.messages[0].response;
    if ('error' in response) throw new Error(response.error);
    expect(response.panels).toStrictEqual(structuredClone(buildEventChartPanelsFromSnapshot(input)));
    for (const panel of response.panels) for (const series of panel.series) {
      expect(series.lineContinuity).toEqual(input.lineContinuity);
      expect(series.lineSegmentIds).toBeInstanceOf(Uint32Array);
      expect(series.lineSegmentIds.length).toBe(series.pointCount);
    }
  });

  it.each([XAxisTypes.Time, XAxisTypes.Duration, XAxisTypes.Distance].flatMap(axis =>
    (['continuous', 'detect', 'custom'] as const).flatMap(mode =>
      [DistanceUnits.Kilometers, DistanceUnits.Miles].map(units => ({ axis, mode, units })))))(
    'roundtrips real overlapping activities through worker transfer ($axis, $mode, $units)', ({ axis, mode, units }) => {
      const seconds = Array.from({ length: 40 }, (_, index) => index);
      const distance = seconds.map(second => second % 2 || (second >= 20 && second < 28)
        ? null : Math.max(0, second - 2) * 10);
      const activities = [0, 1].map(index => {
        const start = Date.UTC(2026, 0, 1) + index * 10_000;
        const activity = EventImporterJSON.getActivityFromJSON({
          name: '', startDate: start, endDate: start + 39_000, type: ActivityTypes.Running,
          creator: { name: `Synthetic ${index}`, devices: [] }, powerMeter: false, trainer: false,
          stats: {}, laps: [], events: [], intensityZones: [],
          streams: {
            [DataDistance.type]: index ? seconds.map(() => null) : [...distance],
            ...(index ? { [DataStrydDistance.type]: [...distance] } : {}),
            [DataHeartRate.type]: seconds.map(second => index && second >= 10 && second < 16 ? null : 100 + second),
            [DataPower.type]: seconds.map(() => 200),
          },
        });
        activity.setID(`source-${index}`);
        activity.addStream(activity.generateTimeStream());
        return activity;
      });
      const before = structuredClone(activities.map(activity => activity.toJSON()));
      const input: BuildEventChartPanelsInput = {
        selectedActivities: activities, allActivities: activities, xAxisType: axis,
        showAllData: false, dataTypesToUse: [DataHeartRate.type, DataDistance.type],
        lineContinuity: { mode, maxGapSeconds: 2 },
        userUnitSettings: { ...getDefaultUserUnitSettings(), distanceUnits: units },
        eventColorService: { getActivityColor: () => '#123456' } as BuildEventChartPanelsInput['eventColorService'],
      };
      const expected = buildEventChartPanels(input);
      const serialized = createEventChartPanelBuildSnapshot(input);
      const buffers = collectEventChartPanelBuildSnapshotTransferables(serialized);
      const request = structuredClone({ requestID: 73, input: serialized }, { transfer: buffers });
      expect(buffers.every(buffer => buffer.byteLength === 0)).toBe(true);
      const instance = worker();
      instance.send(request);
      const response = instance.messages[0].response;
      if ('error' in response) throw new Error(response.error);
      expect(response.panels).toStrictEqual(structuredClone(expected));
      const hr = response.panels.find(panel => panel.dataType === DataHeartRate.type)!;
      expect(hr.series).toHaveLength(2);
      hr.series.forEach((series, index) => {
        const start = activities[index].startDate.getTime();
        const selectedSeconds = seconds.filter(second => axis !== XAxisTypes.Distance || distance[second] !== null);
        expect(eventChartSeriesToPoints(series)).toEqual(selectedSeconds.map(second => ({
          x: axis === XAxisTypes.Time ? start + second * 1000
            : axis === XAxisTypes.Distance ? distance[second] : second,
          time: start + second * 1000,
          y: index && second >= 10 && second < 16 ? null : 100 + second,
        })));
        const at = (second: number) => selectedSeconds.indexOf(second);
        expect(canConnectEventChartPoints(series, at(2), at(4))).toBe(true);
        expect(canConnectEventChartPoints(series, at(18), at(28)))
          .toBe(axis !== XAxisTypes.Distance || mode === 'continuous');
        if (index) expect(canConnectEventChartPoints(series, at(8), at(16))).toBe(mode === 'continuous');
      });
      expect(activities.map(activity => activity.toJSON())).toEqual(before);
    },
  );

  it('preserves the error envelope and handles the next request', () => {
    const instance = worker();
    instance.send({ requestID: 1, input: null as unknown as EventChartPanelBuildSnapshotInput });
    expect(instance.messages[0].response).toMatchObject({ requestID: 1, error: expect.any(String) });
    instance.send({ requestID: 2, input: snapshot(false, false, XAxisTypes.Duration) });
    expect(instance.messages[1].response).toMatchObject({ requestID: 2, panels: expect.any(Array) });
  });
});
