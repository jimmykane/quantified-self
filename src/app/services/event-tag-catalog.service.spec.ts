import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Auth } from 'app/firebase/auth';
import { Firestore, collection, getDocs } from 'app/firebase/firestore';
import { EventTagCatalogService } from './event-tag-catalog.service';

vi.mock('app/firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('app/firebase/firestore')>(),
  collection: vi.fn((_db, ...path: string[]) => ({ path })),
  getDocs: vi.fn(),
}));

function catalogSnapshot(names: string[]) {
  return { docs: names.map(name => ({ data: () => ({ name }) })) };
}

describe('EventTagCatalogService', () => {
  const auth = { currentUser: { uid: 'owner-1' } };
  let service: EventTagCatalogService;

  beforeEach(() => {
    vi.clearAllMocks();
    auth.currentUser = { uid: 'owner-1' };
    vi.mocked(getDocs).mockResolvedValue(catalogSnapshot(['Older', 'Race']) as never);
    TestBed.configureTestingModule({
      providers: [EventTagCatalogService, { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: auth }],
    });
    service = TestBed.inject(EventTagCatalogService);
  });

  it('reads the owner collection directly and reuses its short cache', async () => {
    await expect(service.listAllTags('owner-1')).resolves.toEqual(['Older', 'Race']);
    await expect(service.listAllTags('owner-1')).resolves.toEqual(['Older', 'Race']);
    expect(collection).toHaveBeenCalledWith(expect.anything(), 'users', 'owner-1', 'eventTagCatalog');
    expect(getDocs).toHaveBeenCalledOnce();

    await service.listAllTags('owner-1', true);
    expect(getDocs).toHaveBeenCalledTimes(2);
  });

  it('refreshes after expiry and merges newly saved tags immediately', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      await service.listAllTags('owner-1');
      service.noteSavedTags('owner-1', [' race ', 'New']);
      await expect(service.listAllTags('owner-1')).resolves.toEqual(['New', 'Older', 'Race']);
      now.mockReturnValue(1_000_000 + 2 * 60 * 1000 + 1);
      await service.listAllTags('owner-1');
      expect(getDocs).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it('retries a failed read rather than caching the failure', async () => {
    vi.mocked(getDocs).mockRejectedValueOnce(new Error('offline'));
    await expect(service.listAllTags('owner-1')).rejects.toThrow('offline');
    await expect(service.listAllTags('owner-1')).resolves.toEqual(['Older', 'Race']);
    expect(getDocs).toHaveBeenCalledTimes(2);
  });

  it('rejects a mismatched owner and an account switch during the read', async () => {
    let resolveRequest!: (value: ReturnType<typeof catalogSnapshot>) => void;
    vi.mocked(getDocs).mockReturnValueOnce(new Promise(resolve => { resolveRequest = resolve; }) as never);
    await expect(service.listAllTags('other-owner')).rejects.toThrow('signed-in account');
    expect(getDocs).not.toHaveBeenCalled();

    const pending = service.listAllTags('owner-1');
    auth.currentUser = { uid: 'other-owner' };
    resolveRequest(catalogSnapshot(['Private']));
    await expect(pending).rejects.toThrow('account changed');
    service.noteSavedTags('owner-1', ['Private']);
    await expect(service.listAllTags('owner-1')).rejects.toThrow('signed-in account');
  });
});
