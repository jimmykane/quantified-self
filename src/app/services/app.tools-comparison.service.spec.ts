import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { createHash } from 'node:crypto';
import {
  ReadableStream as NodeReadableStream,
  TransformStream as NodeTransformStream,
  WritableStream as NodeWritableStream,
} from 'node:stream/web';
import { gunzipSync, gzipSync } from 'node:zlib';

import { AppToolsComparisonService } from './app.tools-comparison.service';
import { FirebaseApp } from 'app/firebase/app';
import { Auth } from 'app/firebase/auth';
import { AppCheckReadinessService } from './app-check-readiness.service';
import { AppEventService } from './app.event.service';
import {
  TOOL_COMPARISON_EVENT_ID_HEADER,
  buildToolComparisonContentHashParts,
  buildToolComparisonEventIDHashParts,
  getToolComparisonBaseExtension,
} from '@shared/tool-comparison-id';
import { environment } from '../../environments/environment';
import { User } from '@sports-alliance/sports-lib';

describe('AppToolsComparisonService', () => {
  let service: AppToolsComparisonService;
  let authMock: any;
  let appMock: any;
  let appCheckReadinessMock: Pick<AppCheckReadinessService, 'getToken'>;
  let eventServiceMock: Pick<AppEventService, 'getEventCountBy' | 'getEventsPageOnceByWithMeta'>;
  let fetchMock: any;
  let originalLocalhost: boolean;
  let originalUseFunctionsEmulator: boolean;
  let originalFileReader: typeof FileReader;
  let originalCrypto: Crypto | undefined;
  let originalDecompressionStream: typeof DecompressionStream | undefined;
  let originalReadableStream: typeof ReadableStream | undefined;
  let originalTransformStream: typeof TransformStream | undefined;
  let originalWritableStream: typeof WritableStream | undefined;
  let bytesByFile: WeakMap<File, ArrayBuffer>;

  beforeEach(() => {
    originalLocalhost = environment.localhost;
    originalUseFunctionsEmulator = environment.useFunctionsEmulator;
    originalFileReader = globalThis.FileReader;
    originalCrypto = globalThis.crypto;
    originalDecompressionStream = globalThis.DecompressionStream;
    originalReadableStream = globalThis.ReadableStream;
    originalTransformStream = globalThis.TransformStream;
    originalWritableStream = globalThis.WritableStream;
    bytesByFile = new WeakMap<File, ArrayBuffer>();

    class MockFileReader {
      result: ArrayBuffer | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      readAsArrayBuffer(file: File): void {
        const bytes = bytesByFile.get(file);
        if (!bytes) {
          this.onerror?.();
          return;
        }
        this.result = bytes;
        this.onload?.();
      }
    }

    (globalThis as any).FileReader = MockFileReader;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        ...originalCrypto,
        subtle: {
          digest: vi.fn(async (_algorithm: string, data: BufferSource) => {
            const bytes = data instanceof ArrayBuffer
              ? new Uint8Array(data)
              : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            const digest = createHash('sha256').update(bytes).digest();
            return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
          }),
        },
      },
    });
  });

  beforeEach(() => {
    fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;

    authMock = {
      currentUser: {
        uid: 'user-1',
        getIdToken: vi.fn().mockResolvedValue('id-token'),
      },
    };
    appMock = {
      options: {
        projectId: 'quantified-self-io',
      },
    };
    appCheckReadinessMock = {
      getToken: vi.fn().mockResolvedValue('app-check-token'),
    };
    eventServiceMock = {
      getEventCountBy: vi.fn().mockResolvedValue(3),
      getEventsPageOnceByWithMeta: vi.fn().mockReturnValue(of({
        events: [],
        lastCursor: null,
        hasMore: false,
      })),
    };

    TestBed.configureTestingModule({
      providers: [
        AppToolsComparisonService,
        { provide: Auth, useValue: authMock },
        { provide: FirebaseApp, useValue: appMock },
        { provide: AppCheckReadinessService, useValue: appCheckReadinessMock },
        { provide: AppEventService, useValue: eventServiceMock },
      ],
    });

    service = TestBed.inject(AppToolsComparisonService);
  });

  afterEach(() => {
    environment.localhost = originalLocalhost;
    environment.useFunctionsEmulator = originalUseFunctionsEmulator;
    globalThis.FileReader = originalFileReader;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
    Object.defineProperty(globalThis, 'DecompressionStream', {
      configurable: true,
      value: originalDecompressionStream,
    });
    Object.defineProperty(globalThis, 'ReadableStream', {
      configurable: true,
      value: originalReadableStream,
    });
    Object.defineProperty(globalThis, 'TransformStream', {
      configurable: true,
      value: originalTransformStream,
    });
    Object.defineProperty(globalThis, 'WritableStream', {
      configurable: true,
      value: originalWritableStream,
    });
  });

  function makeFile(name: string, bytes: number[]): File {
    const array = new Uint8Array(bytes);
    const file = new File([array], name);
    bytesByFile.set(file, array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength));
    return file;
  }

  function sha256Hex(parts: ReadonlyArray<string | Uint8Array>): string {
    const hash = createHash('sha256');
    for (const part of parts) {
      hash.update(part);
    }
    return hash.digest('hex');
  }

  function expectedComparisonEventID(userID: string, files: Array<{ extension: string; bytes: number[] }>): string {
    const contentHashes = files.map(file => sha256Hex(buildToolComparisonContentHashParts(
      getToolComparisonBaseExtension(file.extension),
      new Uint8Array(file.bytes),
    )));

    return sha256Hex(buildToolComparisonEventIDHashParts(userID, contentHashes));
  }

  function installNodeWebStreamGlobals(): void {
    Object.defineProperty(globalThis, 'ReadableStream', {
      configurable: true,
      value: NodeReadableStream as unknown as typeof ReadableStream,
    });
    Object.defineProperty(globalThis, 'TransformStream', {
      configurable: true,
      value: NodeTransformStream as unknown as typeof TransformStream,
    });
    Object.defineProperty(globalThis, 'WritableStream', {
      configurable: true,
      value: NodeWritableStream as unknown as typeof WritableStream,
    });
  }

  function installNodeGunzipDecompressionStreamMock(): void {
    installNodeWebStreamGlobals();
    class NodeGunzipDecompressionStream {
      readonly readable: ReadableStream<Uint8Array>;
      readonly writable: WritableStream<Uint8Array>;

      constructor(format: CompressionFormat) {
        if (format !== 'gzip') {
          throw new Error(`Unsupported compression format ${format}.`);
        }
        const transform = new NodeTransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            const decompressed = gunzipSync(Buffer.from(chunk));
            controller.enqueue(new Uint8Array(
              decompressed.buffer,
              decompressed.byteOffset,
              decompressed.byteLength,
            ));
          },
        });
        this.readable = transform.readable as unknown as ReadableStream<Uint8Array>;
        this.writable = transform.writable as unknown as WritableStream<Uint8Array>;
      }
    }

    Object.defineProperty(globalThis, 'DecompressionStream', {
      configurable: true,
      value: NodeGunzipDecompressionStream as unknown as typeof DecompressionStream,
    });
  }

  it('uploads comparison files with auth, App Check, manifest, and title headers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        eventId: 'event-1',
        mergeType: 'benchmark',
        sourceFilesCount: 2,
        activitiesCount: 2,
        uploadLimit: 100,
        uploadCountAfterWrite: 4,
      }),
    });

    const files = [
      makeFile('Garmin.fit', [1, 2, 3]),
      makeFile('Suunto.gpx', [4, 5]),
    ];
    const result = await service.createComparison(files, 'Review set');

    expect(authMock.currentUser.getIdToken).toHaveBeenCalledWith(true);
    expect(appCheckReadinessMock.getToken).toHaveBeenCalledWith();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5001/quantified-self-io/europe-west2/createToolComparisonEvent',
      expect.objectContaining({
        method: 'POST',
      }),
    );

    const fetchOptions = fetchMock.mock.calls[0][1];
    const headers = fetchOptions.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer id-token');
    expect(headers.get('X-Firebase-AppCheck')).toBe('app-check-token');
    expect(headers.get('X-Tool-Comparison-Title-Encoded')).toBe('Review%20set');
    expect(headers.get(TOOL_COMPARISON_EVENT_ID_HEADER)).toBe(expectedComparisonEventID('user-1', [
      { extension: 'fit', bytes: [1, 2, 3] },
      { extension: 'gpx', bytes: [4, 5] },
    ]));

    const manifest = JSON.parse(decodeURIComponent(headers.get('X-Tool-Comparison-Files-Encoded') || '[]'));
    expect(manifest).toEqual([
      { originalFilename: 'Garmin.fit', extension: 'fit', byteLength: 3 },
      { originalFilename: 'Suunto.gpx', extension: 'gpx', byteLength: 2 },
    ]);
    expect(Array.from(new Uint8Array(fetchOptions.body as ArrayBuffer))).toEqual([1, 2, 3, 4, 5]);
    expect(result.eventId).toBe('event-1');
  });

  it('caps programmatic comparison titles before sending the encoded header', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        eventId: 'event-1',
        mergeType: 'benchmark',
      }),
    });

    await service.createComparison([
      makeFile('one.fit', [1]),
      makeFile('two.gpx', [2]),
    ], ` ${'A'.repeat(140)} `);

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(decodeURIComponent(headers.get('X-Tool-Comparison-Title-Encoded') || '')).toBe('A'.repeat(120));
  });

  it('sends deterministic event id hints for gzip comparison files using decompressed payloads', async () => {
    installNodeGunzipDecompressionStreamMock();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        eventId: 'event-1',
        mergeType: 'benchmark',
      }),
    });
    const decompressedFitBytes = [9, 8, 7, 6];
    const gzippedFitBytes = Array.from(gzipSync(new Uint8Array(decompressedFitBytes)));

    await service.createComparison([
      makeFile('one.fit.gz', gzippedFitBytes),
      makeFile('two.gpx', [2]),
    ]);

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get(TOOL_COMPARISON_EVENT_ID_HEADER)).toBe(expectedComparisonEventID('user-1', [
      { extension: 'fit.gz', bytes: decompressedFitBytes },
      { extension: 'gpx', bytes: [2] },
    ]));
  });

  it('sends deterministic event id hints when gzip magic bytes are disguised as an uncompressed extension', async () => {
    installNodeGunzipDecompressionStreamMock();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        eventId: 'event-1',
        mergeType: 'benchmark',
      }),
    });
    const decompressedFitBytes = [3, 4, 5, 6];
    const gzippedFitBytes = Array.from(gzipSync(new Uint8Array(decompressedFitBytes)));

    await service.createComparison([
      makeFile('one.fit', gzippedFitBytes),
      makeFile('two.gpx', [2]),
    ]);

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get(TOOL_COMPARISON_EVENT_ID_HEADER)).toBe(expectedComparisonEventID('user-1', [
      { extension: 'fit', bytes: decompressedFitBytes },
      { extension: 'gpx', bytes: [2] },
    ]));
  });

  it('skips deterministic gzip event id hints when decompression would exceed the allowed hash payload', async () => {
    installNodeWebStreamGlobals();
    const oversizedChunk = { byteLength: 3 } as Uint8Array;
    class OversizedDecompressionStream {
      readonly readable: ReadableStream<Uint8Array>;
      readonly writable: WritableStream<Uint8Array>;

      constructor() {
        const transform = new NodeTransformStream<Uint8Array, Uint8Array>({
          transform(_chunk, controller) {
            controller.enqueue(oversizedChunk);
          },
        });
        this.readable = transform.readable as unknown as ReadableStream<Uint8Array>;
        this.writable = transform.writable as unknown as WritableStream<Uint8Array>;
      }
    }
    Object.defineProperty(globalThis, 'DecompressionStream', {
      configurable: true,
      value: OversizedDecompressionStream as unknown as typeof DecompressionStream,
    });

    const payloadForHash = await (service as any).resolvePayloadForComparisonHash({
      bytes: new Uint8Array([0x1f, 0x8b, 0x08, 0x00]).buffer,
      extension: 'fit.gz',
    }, 2);

    expect(payloadForHash).toBeNull();
  });

  it('validates file count, extensions, and file sizes before upload', async () => {
    await expect(service.createComparison([makeFile('one.fit', [1])]))
      .rejects
      .toThrow('at least 2 files');

    await expect(service.createComparison([
      makeFile('one.fit', [1]),
      makeFile('two.json', [2]),
    ])).rejects.toThrow('Only FIT, GPX, and TCX files');

    const oversizedFile = makeFile('huge.fit', [1, 2]);
    Object.defineProperty(oversizedFile, 'size', { value: (20 * 1024 * 1024) + 1 });
    await expect(service.createComparison([makeFile('one.fit', [1]), oversizedFile]))
      .rejects
      .toThrow('larger than 20MB');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when user is not authenticated', async () => {
    authMock.currentUser = null;

    await expect(service.createComparison([
      makeFile('one.fit', [1]),
      makeFile('two.gpx', [2]),
    ])).rejects.toThrow('authenticated');
  });

  it('surfaces backend and fallback comparison errors', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: vi.fn().mockResolvedValue({ error: 'Duplicate files.' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new SyntaxError('not json')),
      });

    const files = [makeFile('one.fit', [1]), makeFile('two.gpx', [2])];

    await expect(service.createComparison(files)).rejects.toThrow('Duplicate files.');
    await expect(service.createComparison(files)).rejects.toThrow('temporarily unavailable');
  });

  it('rejects malformed successful comparison responses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ eventId: 'event-1', mergeType: 'multi' }),
    });

    await expect(service.createComparison([
      makeFile('one.fit', [1]),
      makeFile('two.gpx', [2]),
    ])).rejects.toThrow('invalid response');
  });

  it('rejects successful comparison responses without a usable event id', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ eventId: '   ', mergeType: 'benchmark' }),
    });

    await expect(service.createComparison([
      makeFile('one.fit', [1]),
      makeFile('two.gpx', [2]),
    ])).rejects.toThrow('invalid response');
  });

  it('normalizes invalid optional count fields from successful responses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        eventId: ' event-1 ',
        mergeType: 'benchmark',
        sourceFilesCount: -2,
        activitiesCount: 1.5,
        uploadLimit: -1,
        uploadCountAfterWrite: Number.POSITIVE_INFINITY,
      }),
    });

    const result = await service.createComparison([
      makeFile('one.fit', [1]),
      makeFile('two.gpx', [2]),
    ]);

    expect(result).toEqual({
      eventId: 'event-1',
      mergeType: 'benchmark',
      sourceFilesCount: 0,
      activitiesCount: 0,
      uploadLimit: null,
      uploadCountAfterWrite: null,
      alreadyExists: false,
    });
  });

  it('uses production function URL when the emulator is disabled', async () => {
    environment.useFunctionsEmulator = false;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        eventId: 'event-1',
        mergeType: 'benchmark',
        sourceFilesCount: 2,
        activitiesCount: 2,
        uploadLimit: 100,
        uploadCountAfterWrite: 4,
      }),
    });

    await service.createComparison([makeFile('one.fit', [1]), makeFile('two.gpx', [2])]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://europe-west2-quantified-self-io.cloudfunctions.net/createToolComparisonEvent',
      expect.any(Object),
    );
  });

  it('counts saved benchmark comparisons through AppEventService', async () => {
    const user = new User('user-1');

    const result = await firstValueFrom(service.getBenchmarkComparisonCount(user));

    expect(result).toBe(3);
    expect(eventServiceMock.getEventCountBy).toHaveBeenCalledWith(
      user,
      [
        { fieldPath: 'mergeType', opStr: '==', value: 'benchmark' },
      ],
    );
  });

  it('loads saved benchmark comparison pages through AppEventService without a fixed list cap', () => {
    const user = new User('user-1');
    const cursor = { id: 'cursor-1' } as any;

    service.getBenchmarkComparisonPage(user, { pageSize: 25, cursor, sort: { active: 'date', direction: 'asc' } }).subscribe();

    expect(eventServiceMock.getEventsPageOnceByWithMeta).toHaveBeenCalledWith(
      user,
      [
        { fieldPath: 'mergeType', opStr: '==', value: 'benchmark' },
      ],
      'startDate',
      true,
      25,
      { startAfterCursor: cursor },
    );
  });

  it('defaults saved benchmark comparison pages to start date descending', () => {
    const user = new User('user-1');

    service.getBenchmarkComparisonPage(user, { pageSize: 25 }).subscribe();

    expect(eventServiceMock.getEventsPageOnceByWithMeta).toHaveBeenCalledWith(
      user,
      [
        { fieldPath: 'mergeType', opStr: '==', value: 'benchmark' },
      ],
      'startDate',
      false,
      25,
      { startAfterCursor: null },
    );
  });

  it('falls back to date sorting for unsupported saved benchmark comparison sort columns', () => {
    const user = new User('user-1');
    const unsupportedRequest = {
      pageSize: 25,
      sort: { active: 'devices', direction: 'desc' },
    } as Parameters<AppToolsComparisonService['getBenchmarkComparisonPage']>[1];

    service.getBenchmarkComparisonPage(user, unsupportedRequest).subscribe();

    expect(eventServiceMock.getEventsPageOnceByWithMeta).toHaveBeenCalledWith(
      user,
      [
        { fieldPath: 'mergeType', opStr: '==', value: 'benchmark' },
      ],
      'startDate',
      false,
      25,
      { startAfterCursor: null },
    );
  });

});
