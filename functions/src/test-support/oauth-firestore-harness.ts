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

interface Document {
  id: string;
  path: string;
  parent: Collection;
  get: Mock<() => Promise<Snapshot>>;
  set: Mock<(values: Data, options?: SetOptions) => Promise<void>>;
  update: Mock<(values: Data) => Promise<void>>;
  delete: Mock<() => Promise<void>>;
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
 * Transactions stage writes, preserve their order, and discard failed commits.
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

  const read = (path: string) => copy(data.get(path));
  const write = (path: string, values: Data, merge = false) => {
    const next = merge ? read(path) || {} : {};
    for (const [key, value] of Object.entries(values)) {
      if (value === 'delete-sentinel') delete next[key];
      else next[key] = copy(value);
    }
    data.set(path, next);
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
        set: vi.fn(async (values: Data, options?: SetOptions) => {
          await setDocument(ref, values, options);
          write(path, values, options?.merge);
        }),
        update: vi.fn(async (values: Data) => {
          if (!data.has(path)) throw new Error(`Cannot update missing fixture document: ${path}`);
          await updateDocument(ref, values);
          write(path, values, true);
        }),
        delete: vi.fn(async () => {
          await deleteDocument(ref);
          data.delete(path);
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
    const writes: Array<() => Promise<unknown>> = [];
    const result = await callback({
      get: async <T>(target: { get: () => Promise<T> }) => {
        if (writes.length) throw new Error('Fixture transaction reads must precede writes');
        if (target.get) return target.get();
        throw new Error('Unknown fixture transaction read');
      },
      set: (ref, values, options) => writes.push(() => ref.set(values, options)),
      update: (ref, values) => writes.push(() => ref.update(values)),
      delete: ref => writes.push(() => ref.delete()),
    });
    const beforeCommit = new Map(data);
    try {
      for (const commit of writes) await commit();
    } catch (error) {
      data.clear();
      for (const [path, value] of beforeCommit) data.set(path, value);
      throw error;
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
        removeRoot: () => data.delete(root.path),
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
