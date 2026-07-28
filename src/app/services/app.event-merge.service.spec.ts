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
    vi.spyOn(service as any, 'waitBeforeRetry').mockResolvedValue(undefined);
  });

  it('should call mergeEvents callable with eventIds and mergeType', async () => {
    const result = await service.mergeEvents(['e1', 'e2'], 'benchmark');

    expect(functionsServiceMock.call).toHaveBeenCalledWith('mergeEvents', {
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
    expect(functionsServiceMock.call).toHaveBeenCalledTimes(1);
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

  it('should map invalid-argument to INVALID_ARGUMENT error', async () => {
    functionsServiceMock.call.mockRejectedValueOnce({
      code: 'functions/invalid-argument',
      message: 'bad request',
    });

    await expect(service.mergeEvents(['e1'], 'benchmark')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('should map failed-precondition to MISSING_SOURCE_FILE error', async () => {
    functionsServiceMock.call.mockRejectedValueOnce({
      code: 'functions/failed-precondition',
      message: 'missing source file',
    });

    await expect(service.mergeEvents(['e1', 'e2'], 'benchmark')).rejects.toMatchObject({
      code: 'MISSING_SOURCE_FILE',
    });
  });

  it('should map already-exists to DUPLICATE_SOURCE_FILE error', async () => {
    functionsServiceMock.call.mockRejectedValueOnce({
      code: 'functions/already-exists',
      message: 'duplicate source file',
    });

    await expect(service.mergeEvents(['e1', 'e2'], 'benchmark')).rejects.toMatchObject({
      code: 'DUPLICATE_SOURCE_FILE',
    });
  });

  it('should reconcile a transient timeout by retrying the identical request', async () => {
    functionsServiceMock.call.mockRejectedValueOnce({
      code: 'functions/deadline-exceeded',
      message: '504 Gateway Timeout',
    });

    await expect(service.mergeEvents(['e1', 'e2'], 'benchmark')).resolves.toMatchObject({
      eventId: 'merged-event-id',
    });
    expect(functionsServiceMock.call).toHaveBeenCalledTimes(2);
    expect(functionsServiceMock.call).toHaveBeenNthCalledWith(2, 'mergeEvents', {
      eventIds: ['e1', 'e2'],
      mergeType: 'benchmark',
    });
  });

  it('should reconcile a raw gateway failure without a callable error code', async () => {
    functionsServiceMock.call.mockRejectedValueOnce(new Error('502 Bad Gateway'));

    await expect(service.mergeEvents(['e1', 'e2'], 'benchmark')).resolves.toMatchObject({
      eventId: 'merged-event-id',
    });
    expect(functionsServiceMock.call).toHaveBeenCalledTimes(2);
  });

  it('should reconcile an in-progress response by retrying the identical request', async () => {
    functionsServiceMock.call.mockRejectedValueOnce({
      code: 'functions/aborted',
      message: 'Merge is already in progress',
    });

    await expect(service.mergeEvents(['e1', 'e2'], 'benchmark')).resolves.toMatchObject({
      eventId: 'merged-event-id',
    });
    expect(functionsServiceMock.call).toHaveBeenCalledTimes(2);
  });

  it('should report an unknown outcome after bounded ambiguous retries', async () => {
    functionsServiceMock.call.mockRejectedValue({
      code: 'functions/internal',
      message: 'internal crash',
    });

    await expect(service.mergeEvents(['e1', 'e2'], 'benchmark')).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect(functionsServiceMock.call).toHaveBeenCalledTimes(3);
  });

  it('should map non-callable failures to INTERNAL without retrying', async () => {
    functionsServiceMock.call.mockRejectedValueOnce(new Error('local crash'));

    await expect(service.mergeEvents(['e1', 'e2'], 'benchmark')).rejects.toMatchObject({
      code: 'INTERNAL',
      message: 'local crash',
    });
    expect(functionsServiceMock.call).toHaveBeenCalledTimes(1);
  });

  it('should return friendly error messages', () => {
    expect(service.getMergeErrorMessage(new EventMergeError('INVALID_ARGUMENT', 'x'))).toContain('selection is invalid');
    expect(service.getMergeErrorMessage(new EventMergeError('LIMIT_REACHED', 'x'))).toContain('Upload limit reached');
    expect(service.getMergeErrorMessage(new EventMergeError('EVENT_NOT_FOUND', 'x'))).toContain('not found');
    expect(service.getMergeErrorMessage(new EventMergeError('MISSING_SOURCE_FILE', 'x'))).toContain('missing original files');
    expect(service.getMergeErrorMessage(new EventMergeError('DUPLICATE_SOURCE_FILE', 'x'))).toContain('identical source files');
    expect(service.getMergeErrorMessage(new EventMergeError('OUTCOME_UNKNOWN', 'x'))).toContain('existing result will be reused');
    expect(service.getMergeErrorMessage(new EventMergeError('INTERNAL', 'x'))).toBe('Could not merge events.');
    expect(service.getMergeErrorMessage(new Error('boom'))).toBe('boom');
    expect(service.getMergeErrorMessage(null)).toBe('Could not merge events.');
  });
});
