import { describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartTypes,
} from '@sports-alliance/sports-lib';
import type { AiInsightsResponse } from '../../../../shared/ai-insights.types';
import { createAiInsightsLatestSnapshotStore } from './latest-snapshot-store';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

describe('latest snapshot store', () => {
  it('strips undefined fields before persisting snapshots', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const warn = vi.fn();
    const db = () => ({
      collection: () => ({
        doc: () => ({
          collection: () => ({
            doc: () => ({
              set,
            }),
          }),
        }),
      }),
    }) as unknown as FirebaseFirestore.Firestore;

    const store = createAiInsightsLatestSnapshotStore({
      db,
      now: () => new Date('2026-03-22T10:00:00.000Z'),
      logger: { warn },
    });

    const response: AiInsightsResponse = {
      status: 'ok',
      resultKind: 'latest_event',
      narrative: 'Your latest cycling event was on Mar 20, 2026.',
      query: {
        resultKind: 'latest_event',
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: undefined,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        requestedDateRanges: undefined,
        periodMode: undefined,
        chartType: ChartTypes.LinesVertical,
      },
      latestEvent: {
        eventId: 'event-9',
        startDate: '2026-03-20T08:00:00.000Z',
        matchedEventCount: 4,
      },
      presentation: {
        title: 'Latest event for cycling',
        chartType: ChartTypes.LinesVertical,
      },
    };

    await store.persistLatestAiInsightsSnapshot('user-1', 'When was my last ride?', response);

    expect(set).toHaveBeenCalledTimes(1);
    const persistedSnapshot = set.mock.calls[0][0] as {
      response: {
        query: Record<string, unknown>;
      };
    };
    expect('requestedTimeInterval' in persistedSnapshot.response.query).toBe(false);
    expect('requestedDateRanges' in persistedSnapshot.response.query).toBe(false);
    expect('periodMode' in persistedSnapshot.response.query).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});
