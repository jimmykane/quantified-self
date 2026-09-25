import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { Auth } from 'app/firebase/auth';
import { AppFunctionsService } from './app.functions.service';
import { EventTagCatalogService } from './event-tag-catalog.service';

describe('EventTagCatalogService', () => {
  it('requests the signed-in account tag catalog without a user ID argument', async () => {
    const functionsService = { call: vi.fn().mockResolvedValue({ data: { tags: ['Older', 'Race'] } }) };
    const auth = { currentUser: { uid: 'owner-1' } };
    TestBed.configureTestingModule({
      providers: [EventTagCatalogService, { provide: AppFunctionsService, useValue: functionsService },
        { provide: Auth, useValue: auth }],
    });

    const service = TestBed.inject(EventTagCatalogService);
    await expect(service.listAllTags('owner-1')).resolves.toEqual(['Older', 'Race']);
    await expect(service.listAllTags('owner-1')).resolves.toEqual(['Older', 'Race']);
    expect(functionsService.call).toHaveBeenCalledOnce();

    await service.listAllTags('owner-1', true);
    expect(functionsService.call).toHaveBeenCalledTimes(2);
    expect(functionsService.call).toHaveBeenCalledWith('listEventTags', undefined,
      { canExecute: expect.any(Function) });
  });

  it('retries a failed request rather than caching the failure', async () => {
    let rejectRequest!: (error: Error) => void;
    const functionsService = { call: vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }))
      .mockResolvedValueOnce({ data: { tags: ['Race'] } }) };
    TestBed.configureTestingModule({
      providers: [EventTagCatalogService, { provide: AppFunctionsService, useValue: functionsService },
        { provide: Auth, useValue: { currentUser: { uid: 'owner-1' } } }],
    });
    const service = TestBed.inject(EventTagCatalogService);

    const pending = service.listAllTags('owner-1');
    rejectRequest(new Error('offline'));
    await expect(pending).rejects.toThrow('offline');
    await expect(service.listAllTags('owner-1')).resolves.toEqual(['Race']);
    expect(functionsService.call).toHaveBeenCalledTimes(2);
  });

  it('rejects a mismatched owner and an account switch during the request', async () => {
    let resolveRequest!: (value: { data: { tags: string[] } }) => void;
    const functionsService = { call: vi.fn().mockReturnValue(new Promise(resolve => {
      resolveRequest = resolve;
    })) };
    const auth = { currentUser: { uid: 'owner-1' } };
    TestBed.configureTestingModule({
      providers: [EventTagCatalogService, { provide: AppFunctionsService, useValue: functionsService },
        { provide: Auth, useValue: auth }],
    });
    const service = TestBed.inject(EventTagCatalogService);

    await expect(service.listAllTags('other-owner')).rejects.toThrow('signed-in account');
    expect(functionsService.call).not.toHaveBeenCalled();

    const pending = service.listAllTags('owner-1');
    auth.currentUser = { uid: 'other-owner' };
    resolveRequest({ data: { tags: ['Private'] } });
    await expect(pending).rejects.toThrow('account changed');
    await expect(service.listAllTags('owner-1')).rejects.toThrow('signed-in account');
  });
});
