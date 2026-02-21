import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppEventMergeService, EventMergeError } from './app.event-merge.service';
import { AppFunctionsService } from './app.functions.service';

describe('AppEventMergeService', () => {
  let service: AppEventMergeService;
  let functionsServiceMock: { call: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    functionsServiceMock = {
      call: vi.fn().mockResolvedValue({
        data: {
          eventId: 'merged-event-id',
          mergeType: 'benchmark',
          sourceEventsCount: 2,
          sourceFilesCount: 2,
          activitiesCount: 2,
          uploadLimit: 10,
          uploadCountAfterWrite: 3,
        },
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        AppEventMergeService,
        { provide: AppFunctionsService, useValue: functionsServiceMock },
      ],
    });

    service = TestBed.inject(AppEventMergeService);
  });

  it('should call mergeEvent callable with eventIds and mergeType', async () => {
    const result = await service.mergeEvents(['e1', 'e2'], 'benchmark');

    expect(functionsServiceMock.call).toHaveBeenCalledWith('mergeEvent', {
      eventIds: ['e1', 'e2'],
      mergeType: 'benchmark',
    });
    expect(result.eventId).toBe('merged-event-id');
  });

  it('should map resource-exhausted to LIMIT_REACHED error', async () => {
    functionsServiceMock.call.mockRejectedValueOnce({
      code: 'functions/resource-exhausted',
      message: 'Upload limit reached',
    });

    await expect(service.mergeEvents(['e1', 'e2'], 'benchmark')).rejects.toMatchObject({
      code: 'LIMIT_REACHED',
    });
  });

  it('should map not-found to EVENT_NOT_FOUND error', async () => {
    functionsServiceMock.call.mockRejectedValueOnce({
      code: 'functions/not-found',
      message: 'missing event',
    });

    await expect(service.mergeEvents(['e1', 'e2'], 'benchmark')).rejects.toMatchObject({
      code: 'EVENT_NOT_FOUND',
    });
  });

  it('should return friendly error messages', () => {
    expect(service.getMergeErrorMessage(new EventMergeError('LIMIT_REACHED', 'x'))).toContain('Upload limit reached');
    expect(service.getMergeErrorMessage(new EventMergeError('EVENT_NOT_FOUND', 'x'))).toContain('not found');
    expect(service.getMergeErrorMessage(new Error('boom'))).toBe('boom');
  });
});
