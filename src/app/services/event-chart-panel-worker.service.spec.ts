import { TestBed } from '@angular/core/testing';
import { XAxisTypes } from '@sports-alliance/sports-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EventChartPanelBuildSnapshotInput,
  EventChartPanelModel,
  EventChartPanelWorkerRequest,
  EventChartPanelWorkerResponse,
} from '../helpers/event-echarts-data.helper';
import { LoggerService } from './logger.service';
import { EventChartPanelWorkerService } from './event-chart-panel-worker.service';

class MockWorker {
  static instances: MockWorker[] = [];

  onmessage: ((event: MessageEvent<EventChartPanelWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    MockWorker.instances.push(this);
  }
}

class ThrowingWorker {
  constructor() {
    throw new Error('worker constructor failed');
  }
}

describe('EventChartPanelWorkerService', () => {
  const loggerMock = {
    warn: vi.fn(),
  };

  beforeEach(() => {
    MockWorker.instances = [];
    loggerMock.warn.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  function createService(): EventChartPanelWorkerService {
    TestBed.configureTestingModule({
      providers: [
        EventChartPanelWorkerService,
        { provide: LoggerService, useValue: loggerMock },
      ],
    });
    return TestBed.inject(EventChartPanelWorkerService);
  }

  function buildSnapshot(): EventChartPanelBuildSnapshotInput {
    return {
      selectedActivities: [
        {
          id: 'a1',
          activityName: 'Activity',
          activityType: 'Running',
          startTimeMs: Date.UTC(2024, 0, 1),
          intensityZones: [],
          streams: [
            { type: XAxisTypes.Time, values: new Float64Array([0, 1]) },
            { type: 'Power', values: new Float64Array([100, 110]) },
          ],
        },
      ],
      xAxisType: XAxisTypes.Duration,
      showAllData: false,
      dataTypesToUse: ['Power'],
      userUnitSettings: {} as any,
      zoneColors: {},
    };
  }

  function buildPanels(): EventChartPanelModel[] {
    return [
      {
        dataType: 'Power',
        displayName: 'Power',
        unit: 'W',
        colorGroupKey: 'Power',
        minX: 0,
        maxX: 1,
        series: [
          {
            id: 'a1::Power',
            activityID: 'a1',
            activityName: 'Activity',
            color: '#ff0000',
            streamType: 'Power',
            displayName: 'Power',
            unit: 'W',
            lineValues: new Float64Array([0, 100, 1, 110]),
            timeValues: new Float64Array([0, 1000]),
            pointCount: 2,
          },
        ],
      },
    ];
  }

  it('uses the fallback builder when Web Workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const service = createService();
    const fallbackPanels = buildPanels();
    const fallbackBuilder = vi.fn(() => fallbackPanels);

    await expect(service.buildPanels(buildSnapshot(), fallbackBuilder)).resolves.toBe(fallbackPanels);

    expect(fallbackBuilder).toHaveBeenCalledTimes(1);
    expect(MockWorker.instances).toHaveLength(0);
  });

  it('posts transferable snapshots to the worker and resolves worker panels', async () => {
    vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);
    const service = createService();
    const snapshot = buildSnapshot();
    const fallbackBuilder = vi.fn(() => buildPanels());
    const workerPanels = buildPanels();

    const resultPromise = service.buildPanels(snapshot, fallbackBuilder);

    const worker = MockWorker.instances[0];
    expect(worker).toBeDefined();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const [request, transferables] = worker.postMessage.mock.calls[0] as [
      EventChartPanelWorkerRequest,
      Transferable[],
    ];
    expect(request.requestID).toBe(1);
    expect(transferables).toContain(snapshot.selectedActivities[0].streams[0].values.buffer);
    expect(transferables).toContain(snapshot.selectedActivities[0].streams[1].values.buffer);

    worker.onmessage?.({
      data: { requestID: request.requestID, panels: workerPanels },
    } as MessageEvent<EventChartPanelWorkerResponse>);

    await expect(resultPromise).resolves.toBe(workerPanels);
    expect(fallbackBuilder).not.toHaveBeenCalled();
  });

  it('falls back after a worker failure and disables later worker attempts', async () => {
    vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);
    const service = createService();
    const fallbackPanels = buildPanels();
    const fallbackBuilder = vi.fn(() => fallbackPanels);

    const resultPromise = service.buildPanels(buildSnapshot(), fallbackBuilder);
    const worker = MockWorker.instances[0];
    const [request] = worker.postMessage.mock.calls[0] as [EventChartPanelWorkerRequest, Transferable[]];
    worker.onmessage?.({
      data: { requestID: request.requestID, error: 'boom' },
    } as MessageEvent<EventChartPanelWorkerResponse>);

    await expect(resultPromise).resolves.toBe(fallbackPanels);
    expect(fallbackBuilder).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);

    const nextFallbackPanels = buildPanels();
    const nextFallbackBuilder = vi.fn(() => nextFallbackPanels);
    await expect(service.buildPanels(buildSnapshot(), nextFallbackBuilder)).resolves.toBe(nextFallbackPanels);
    expect(nextFallbackBuilder).toHaveBeenCalledTimes(1);
    expect(MockWorker.instances).toHaveLength(1);
  });

  it('falls back and disables the worker after a runtime worker error event', async () => {
    vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);
    const service = createService();
    const fallbackPanels = buildPanels();
    const fallbackBuilder = vi.fn(() => fallbackPanels);

    const resultPromise = service.buildPanels(buildSnapshot(), fallbackBuilder);
    const worker = MockWorker.instances[0];
    worker.onerror?.({ error: new Error('runtime worker error') } as ErrorEvent);

    await expect(resultPromise).resolves.toBe(fallbackPanels);
    expect(fallbackBuilder).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
  });

  it('falls back when worker construction throws', async () => {
    vi.stubGlobal('Worker', ThrowingWorker as unknown as typeof Worker);
    const service = createService();
    const fallbackPanels = buildPanels();
    const fallbackBuilder = vi.fn(() => fallbackPanels);

    await expect(service.buildPanels(buildSnapshot(), fallbackBuilder)).resolves.toBe(fallbackPanels);

    expect(fallbackBuilder).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(service.shouldUseWorker()).toBe(false);
  });
});
