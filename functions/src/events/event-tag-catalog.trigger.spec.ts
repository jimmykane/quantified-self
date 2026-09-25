import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ onDocumentWritten: vi.fn(), ensure: vi.fn() }));
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: mocks.onDocumentWritten.mockImplementation((_options, handler) => handler),
}));
vi.mock('./event-tag-catalog', async importOriginal => ({
  ...await importOriginal<typeof import('./event-tag-catalog')>(),
  ensureEventTagCatalogEntries: mocks.ensure,
}));

import { projectEventTagCatalog, projectEventTagCatalogSubmission } from './event-tag-catalog.trigger';

const invoke = projectEventTagCatalog as unknown as (event: unknown) => Promise<void>;
const invokeSubmission = projectEventTagCatalogSubmission as unknown as (event: unknown) => Promise<void>;

describe('projectEventTagCatalog', () => {
  it('registers a retryable event trigger and projects only newly assigned tags', async () => {
    expect(mocks.onDocumentWritten).toHaveBeenCalledWith(expect.objectContaining({
      document: 'users/{uid}/events/{eventId}', region: 'europe-west2', retry: true,
    }), expect.any(Function));
    await invoke({ params: { uid: 'owner' }, data: {
      before: { data: () => ({ tags: ['Race'] }) },
      after: { data: () => ({ tags: ['race', 'Recovery'] }) },
    } });
    expect(mocks.ensure).toHaveBeenCalledWith(expect.anything(), 'owner', ['Recovery']);
  });

  it('does not remove saved tags when an event loses them or is deleted', async () => {
    mocks.ensure.mockClear();
    await invoke({ params: { uid: 'owner' }, data: {
      before: { data: () => ({ tags: ['Race'] }) },
      after: { data: () => ({ tags: [] }) },
    } });
    await invoke({ params: { uid: 'owner' }, data: {
      before: { data: () => ({ tags: ['Race'] }) },
      after: { data: () => undefined },
    } });
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it('registers a retryable scoped trigger and projects only valid submissions', async () => {
    expect(mocks.onDocumentWritten).toHaveBeenCalledWith(expect.objectContaining({
      document: 'users/{uid}/eventTagCatalogSubmissions/current',
      region: 'europe-west2', retry: true,
    }), expect.any(Function));
    mocks.ensure.mockClear();
    await invokeSubmission({ params: { uid: 'owner' }, data: {
      after: { exists: true, data: () => ({ tags: [' Race ', 'race', 'Recovery'] }) },
    } });
    expect(mocks.ensure).toHaveBeenCalledWith(expect.anything(), 'owner', ['Race', 'Recovery']);
    mocks.ensure.mockClear();
    await invokeSubmission({ params: { uid: 'owner' }, data: {
      after: { exists: false },
    } });
    await invokeSubmission({ params: { uid: 'owner' }, data: {
      after: { exists: true, data: () => ({ tags: [] }) },
    } });
    expect(mocks.ensure).not.toHaveBeenCalled();
  });
});
