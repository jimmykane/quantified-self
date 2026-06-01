import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';

import { AppToolsComparisonService } from './app.tools-comparison.service';
import { FirebaseApp } from 'app/firebase/app';
import { Auth } from 'app/firebase/auth';
import { AppCheckReadinessService } from './app-check-readiness.service';
import { AppEventService } from './app.event.service';
import { environment } from '../../environments/environment';
import { User } from '@sports-alliance/sports-lib';

describe('AppToolsComparisonService', () => {
  let service: AppToolsComparisonService;
  let authMock: any;
  let appMock: any;
  let appCheckReadinessMock: Pick<AppCheckReadinessService, 'getToken'>;
  let eventServiceMock: Pick<AppEventService, 'getEventsBy'>;
  let fetchMock: any;
  let originalLocalhost: boolean;
  let originalUseFunctionsEmulator: boolean;
  let originalFileReader: typeof FileReader;
  let bytesByFile: WeakMap<File, ArrayBuffer>;

  beforeEach(() => {
    originalLocalhost = environment.localhost;
    originalUseFunctionsEmulator = environment.useFunctionsEmulator;
    originalFileReader = globalThis.FileReader;
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
  });

  beforeEach(() => {
    fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;

    authMock = {
      currentUser: {
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
      getEventsBy: vi.fn().mockReturnValue(of([])),
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
  });

  function makeFile(name: string, bytes: number[]): File {
    const array = new Uint8Array(bytes);
    const file = new File([array], name);
    bytesByFile.set(file, array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength));
    return file;
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

  it('lists saved benchmark comparisons through AppEventService', () => {
    const user = new User('user-1');

    service.getBenchmarkComparisons(user).subscribe();

    expect(eventServiceMock.getEventsBy).toHaveBeenCalledWith(
      user,
      [{ fieldPath: 'mergeType', opStr: '==', value: 'benchmark' }],
      'startDate',
      false,
      100,
    );
  });
});
