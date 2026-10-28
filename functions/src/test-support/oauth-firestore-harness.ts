import { vi, type Mock } from 'vitest';

type Data = Record<string, unknown>;
type SetOptions = { merge?: boolean };

interface Snapshot {
  id: string;
  ref: Document;
  exists: boolean;
  data: () => Data | undefined;
}

interface QuerySnapshot {
  docs: Snapshot[];
  empty: boolean;
  size: number;
}

interface WriteHooks {
  set: Mock<(values: Data, options?: SetOptions) => Promise<void>>;
  update: Mock<(values: Data) => Promise<void>>;
  delete: Mock<() => Promise<void>>;
}

interface Document extends WriteHooks {
  id: string;
  path: string;
  parent: Collection;
  get: Mock<() => Promise<Snapshot>>;
  /** Observe or fail direct and transaction write attempts without replacing persistence. */
  writes: WriteHooks;
  collection: Mock<(name: string) => Collection>;
}

interface Collection {
  id: string;
  path: string;
  parent: Document | null;
  doc: Mock<(id: string) => Document>;
  get: Mock<() => Promise<QuerySnapshot>>;
  where: Mock<(field: string, operator: string, value: unknown) => Collection>;
  limit: Mock<(count: number) => Collection>;
}

interface Transaction {
  get: <T>(target: { get: () => Promise<T> }) => Promise<T>;
  set: (ref: Document, values: Data, options?: SetOptions) => number;
  update: (ref: Document, values: Data) => number;
  delete: (ref: Document) => number;
}

type Write = { kind: 'set'; ref: Document; values: Data; options?: SetOptions }
  | { kind: 'update'; ref: Document; values: Data }
  | { kind: 'delete'; ref: Document };

function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copy) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copy(entry)])) as T;
  }
  return value;
}

/**
 * Per-test OAuth fixture, not a Firestore emulator: no network, contention retry,
 * indexes or security rules. Paths have independent state; snapshots are copies.
 * Transactions capture staged values and publish every write atomically. A
 * competing fixture mutation aborts the transaction instead of retrying it.
 * Only plain fixture data, the delete-field sentinel, and the equality queries
 * used by OAuth duplicate-account cleanup are supported. External auth/lifecycle
 * services remain mocks; use the named connection operations for competing writes.
 */
export function createOAuthFirestoreHarness() {
  const data = new Map<string, Data>();
  const documents = new Map<string, Document>();
  const collections = new Map<string, Collection>();
  const setDocument = vi.fn().mockResolvedValue(undefined);
  const updateDocument = vi.fn().mockResolvedValue(undefined);
  const deleteDocument = vi.fn().mockResolvedValue(undefined);
  const where = vi.fn();
  let revision = 0;

  const read = (path: string) => copy(data.get(path));
  const writeTo = (store: Map<string, Data>, path: string, values: Data, merge = false) => {
    const next = merge ? copy(store.get(path)) || {} : {};
    for (const [key, value] of Object.entries(values)) {
      if (value === 'delete-sentinel') delete next[key];
      else next[key] = copy(value);
    }
    store.set(path, next);
  };
  const write = (path: string, values: Data, merge = false) => {
    writeTo(data, path, values, merge);
    revision++;
  };
  const remove = (path: string) => {
    data.delete(path);
    revision++;
  };
  const snapshot = (ref: Document) => {
    const value = read(ref.path);
    return { id: ref.id, ref, exists: value !== undefined, data: () => copy(value) };
  };

  function document(path: string): Document {
    if (!documents.has(path)) {
      const parts = path.split('/');
      const ref: Document = {
        id: parts[parts.length - 1], path,
        get parent() { return collection(parts.slice(0, -1).join('/')); },
        get: vi.fn(async () => snapshot(ref)),
        writes: {
          set: vi.fn(async (values, options) => { await setDocument(ref, values, options); }),
          update: vi.fn(async values => { await updateDocument(ref, values); }),
          delete: vi.fn(async () => { await deleteDocument(ref); }),
        },
        set: vi.fn(async (values: Data, options?: SetOptions) => {
          const capturedValues = copy(values);
          const capturedOptions = copy(options);
          await ref.writes.set(capturedValues, capturedOptions);
          write(path, capturedValues, capturedOptions?.merge);
        }),
        update: vi.fn(async (values: Data) => {
          const capturedValues = copy(values);
          await ref.writes.update(capturedValues);
          if (!data.has(path)) throw new Error(`Cannot update missing fixture document: ${path}`);
          write(path, capturedValues, true);
        }),
        delete: vi.fn(async () => {
          await ref.writes.delete();
          remove(path);
        }),
        collection: vi.fn((name: string) => collection(`${path}/${name}`)),
      };
      documents.set(path, ref);
    }
    return documents.get(path)!;
  }

  function collection(path: string, group = false): Collection {
    const key = `${group ? 'group:' : ''}${path}`;
    const existing = collections.get(key);
    if (existing) return existing;
    const buildQuery = (filters: Array<[string, unknown]> = [], limit = Infinity): Collection => ({
      path, id: path.substring(path.lastIndexOf('/') + 1),
      get parent() { return path.includes('/') ? document(path.split('/').slice(0, -1).join('/')) : null; },
      doc: vi.fn((id: string) => document(`${path}/${id}`)),
      where: vi.fn((field: string, operator: string, value: unknown) => {
        if (operator !== '==') throw new Error(`Unsupported fixture operator: ${operator}`);
        where(field, operator, value);
        return buildQuery([...filters, [field, value]], limit);
      }),
      limit: vi.fn((count: number) => buildQuery(filters, count)),
      get: vi.fn(async () => {
        const docs = [...data.keys()].filter(candidate => {
          const parts = candidate.split('/');
          return (group ? parts[parts.length - 2] === path : parts.slice(0, -1).join('/') === path)
            && filters.every(([field, value]) => data.get(candidate)?.[field] === value);
        }).slice(0, limit).map(candidate => snapshot(document(candidate)));
        return { docs, empty: docs.length === 0, size: docs.length };
      }),
    });
    const result = buildQuery();
    collections.set(key, result);
    return result;
  }

  const runTransaction = vi.fn(async (callback: (transaction: Transaction) => Promise<unknown>) => {
    const startingRevision = revision;
    const assertUnchanged = () => {
      if (revision !== startingRevision) {
        throw new Error('OAuth fixture transaction conflicted; automatic retries are not modeled');
      }
    };
    const writes: Write[] = [];
    const result = await callback({
      get: async <T>(target: { get: () => Promise<T> }) => {
        if (writes.length) throw new Error('Fixture transaction reads must precede writes');
        if (target.get) return target.get();
        throw new Error('Unknown fixture transaction read');
      },
      set: (ref, values, options) => writes.push({ kind: 'set', ref, values: copy(values), options: copy(options) }),
      update: (ref, values) => writes.push({ kind: 'update', ref, values: copy(values) }),
      delete: ref => writes.push({ kind: 'delete', ref }),
    });
    assertUnchanged();
    const pending = new Map(data);
    for (const write of writes) {
      if (write.kind === 'set') {
        await write.ref.writes.set(write.values, write.options);
        writeTo(pending, write.ref.path, write.values, write.options?.merge);
      } else if (write.kind === 'update') {
        if (!pending.has(write.ref.path)) throw new Error(`Cannot update missing fixture document: ${write.ref.path}`);
        await write.ref.writes.update(write.values);
        writeTo(pending, write.ref.path, write.values, true);
      } else {
        await write.ref.writes.delete();
        pending.delete(write.ref.path);
      }
    }
    assertUnchanged();
    if (writes.length) {
      data.clear();
      for (const [path, value] of pending) data.set(path, value);
      revision++;
    }
    return result;
  });

  const db = {
    collection: vi.fn((path: string) => collection(path)),
    collectionGroup: vi.fn((name: string) => collection(name, true)),
    doc: vi.fn(document),
    runTransaction,
    recursiveDelete: vi.fn(),
  };

  return {
    db, setDocument, updateDocument, deleteDocument, where,
    document, snapshot,
    seed: (ref: Document, values: Data) => write(ref.path, values),
    read: (ref: Document) => read(ref.path),
    connection: (tokenCollection: string, userID: string) => {
      const root = document(`${tokenCollection}/${userID}`);
      const tokens = root.collection('tokens');
      return {
        root, tokens,
        token: (id: string) => document(`${tokens.path}/${id}`),
        seedRoot: (values: Data) => write(root.path, values),
        patchRoot: (values: Data) => write(root.path, values, true),
        readRoot: () => read(root.path),
        removeRoot: () => remove(root.path),
        setOAuthFlow: (values: Data) => write(root.path, values, true),
        setDisconnectGeneration: (values: Data) => write(root.path, values, true),
        persistCredentials: (id: string, values: Data & { tokenCredentialGeneration: string }) => {
          write(root.path, { activeOAuthCredentialGeneration: values.tokenCredentialGeneration }, true);
          write(`${tokens.path}/${id}`, values);
        },
        replaceProviderToken: (id: string, values: Data) => write(`${tokens.path}/${id}`, values),
        readToken: (id: string) => read(`${tokens.path}/${id}`),
      };
    },
  };
}

export type OAuthFirestoreHarness = ReturnType<typeof createOAuthFirestoreHarness>;
