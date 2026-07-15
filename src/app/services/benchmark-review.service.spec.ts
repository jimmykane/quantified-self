import { Clipboard } from '@angular/cdk/clipboard';
import { TestBed } from '@angular/core/testing';
import { BenchmarkResult } from '@shared/app-event.interface';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import { EventTagService } from './event-tag.service';
import { BenchmarkReviewService } from './benchmark-review.service';
import { normalizeBenchmarkReviewTags } from '../helpers/benchmark-review.helper';

describe('BenchmarkReviewService', () => {
  let service: BenchmarkReviewService;
  let eventTagServiceMock: {
    normalizeTags: ReturnType<typeof vi.fn>;
    getTags: ReturnType<typeof vi.fn>;
    saveTags: ReturnType<typeof vi.fn>;
  };
  let clipboardMock: { copy: ReturnType<typeof vi.fn> };

  const result: BenchmarkResult = {
    referenceId: 'ref',
    testId: 'test',
    referenceName: 'Garmin Edge',
    testName: 'Suunto Race',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    timeOffsetSeconds: 2,
    qualityIssues: [
      {
        type: 'dropout',
        streamType: 'HeartRate',
        description: 'Signal dropout',
        severity: 'warning',
      },
    ],
    metrics: {
      gnss: {
        cep50: 2.4,
        cep95: 5.2,
        rmse: 3.1,
        maxDeviation: 10,
        totalDistanceDifference: 20,
        meanAbsoluteError: 2.8,
      },
      streamMetrics: {
        HeartRate: {
          sourceA_mean: 140,
          sourceB_mean: 143,
          meanDeviation: 3,
          pearsonCorrelation: 0.98,
          meanAbsoluteError: 4,
          rootMeanSquareError: 5,
        },
        Altitude: {
          sourceA_mean: 100,
          sourceB_mean: 96,
          meanDeviation: -4,
          pearsonCorrelation: 0.91,
          meanAbsoluteError: 6.2,
          rootMeanSquareError: 7,
        },
      },
    },
  };

  beforeEach(() => {
    eventTagServiceMock = {
      normalizeTags: vi.fn((value: unknown) => normalizeBenchmarkReviewTags(value)),
      getTags: vi.fn((event: any) => normalizeBenchmarkReviewTags(event.tags ?? event.benchmarkReviewTags)),
      saveTags: vi.fn(async (_user: unknown, event: any, value: unknown) => {
        const tags = normalizeBenchmarkReviewTags(value);
        event.tags = tags;
        return tags;
      }),
    };
    clipboardMock = {
      copy: vi.fn().mockReturnValue(true),
    };

    TestBed.configureTestingModule({
      providers: [
        BenchmarkReviewService,
        { provide: EventTagService, useValue: eventTagServiceMock },
        { provide: Clipboard, useValue: clipboardMock },
      ],
    });

    service = TestBed.inject(BenchmarkReviewService);
  });

  it('normalizes reviewer tags with trimming, dedupe, and limits', () => {
    const tags = service.normalizeTags([
      ' firmware ',
      'Firmware',
      'gps   trace',
      '',
      '1234567890123456789012345678901234567890',
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
    ]);

    expect(tags).toEqual([
      'firmware',
      'gps trace',
      '12345678901234567890123456789012',
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
    ]);
  });

  it('builds a deterministic reviewer summary with tags and key metrics', () => {
    const summary = service.buildSummary(result, [' firmware ', 'gps']);

    expect(summary.atAGlanceItems.map(item => item.key)).toEqual([
      'overall',
      'pair',
      'gnss',
      'heart-rate',
      'altitude',
      'quality',
      'tags',
    ]);
    expect(summary.text).toContain('Benchmark summary: Garmin Edge -> Suunto Race');
    expect(summary.text).toContain('GNSS: CEP50 2.4 m, RMSE 3.1 m, MAE 2.8 m');
    expect(summary.text).toContain('HR: MD +3 bpm, MAE 4 bpm, correlation 98.0%');
    expect(summary.text).toContain('Alt: MD -4 m, MAE 6.2 m, correlation 91.0%');
    expect(summary.text).toContain('Tags: firmware, gps');
  });

  it('derives legacy stream MD from stored means when explicit meanDeviation is missing', () => {
    const legacyResult: BenchmarkResult = {
      ...result,
      metrics: {
        ...result.metrics,
        streamMetrics: {
          HeartRate: {
            sourceA_mean: 140,
            sourceB_mean: 136,
            pearsonCorrelation: 0.95,
            meanAbsoluteError: 5,
            rootMeanSquareError: 6,
          },
        },
      },
    };

    const summary = service.buildSummary(legacyResult, []);

    expect(summary.text).toContain('HR: MD -4 bpm, MAE 5 bpm, correlation 95.0%');
  });


  it('copies the reviewer summary text', () => {
    expect(service.copySummary(result, ['review'])).toBe(true);
    expect(clipboardMock.copy).toHaveBeenCalledWith(expect.stringContaining('Tags: review'));
  });

  it('saves normalized event tags through AppEventService', async () => {
    const user = { uid: 'user-1' };
    const event = {
      tags: [],
      getID: () => 'event-1',
    };

    const tags = await service.saveEventTags(
      user as never,
      event as never,
      [' review ', 'Review', 'firmware'],
      ['original'],
    );

    expect(tags).toEqual(['review', 'firmware']);
    expect(eventTagServiceMock.saveTags).toHaveBeenCalledWith(
      user,
      event,
      [' review ', 'Review', 'firmware'],
      ['original'],
    );
    expect(event.tags).toEqual(['review', 'firmware']);
  });
});
