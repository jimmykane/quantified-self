import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppFitUploadService } from './app.fit-upload.service';
import { FirebaseApp } from 'app/firebase/app';
import { Auth } from 'app/firebase/auth';
import { AppCheckReadinessService } from './app-check-readiness.service';
import { environment } from '../../environments/environment';
import { UploadError } from './upload-error';

describe('AppFitUploadService', () => {
  let service: AppFitUploadService;
  let authMock: any;
  let appMock: any;
  let appCheckReadinessMock: Pick<AppCheckReadinessService, 'getToken'>;
  let fetchMock: any;
  let originalLocalhost: boolean;
  let originalUseFunctionsEmulator: boolean;

  beforeEach(() => {
    originalLocalhost = environment.localhost;
    originalUseFunctionsEmulator = environment.useFunctionsEmulator;
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

    TestBed.configureTestingModule({
      providers: [
        AppFitUploadService,
        { provide: Auth, useValue: authMock },
        { provide: FirebaseApp, useValue: appMock },
        { provide: AppCheckReadinessService, useValue: appCheckReadinessMock },
      ]
    });

    service = TestBed.inject(AppFitUploadService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    environment.localhost = originalLocalhost;
    environment.useFunctionsEmulator = originalUseFunctionsEmulator;
  });

  it('should upload activity bytes with auth, app check, and extension headers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        eventId: 'event-1',
        activitiesCount: 1,
        uploadLimit: 10,
        uploadCountAfterWrite: 1,
      }),
    });

    const payload = new Uint8Array([1, 2, 3]).buffer;
    const result = await service.uploadActivityFile(payload, 'gpx.gz', 'run.gpx');

    expect(authMock.currentUser.getIdToken).toHaveBeenCalledWith();
    expect(appCheckReadinessMock.getToken).toHaveBeenCalledWith();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5001/quantified-self-io/europe-west2/uploadActivity',
      expect.objectContaining({
        method: 'POST',
        body: payload,
      }),
    );

    const fetchOptions = fetchMock.mock.calls[0][1];
    const headers = fetchOptions.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer id-token');
    expect(headers.get('X-Firebase-AppCheck')).toBe('app-check-token');
    expect(headers.get('X-File-Extension')).toBe('gpx.gz');
    expect(headers.get('X-Original-Filename')).toBe('run.gpx');
    expect(headers.get('X-Original-Filename-Encoded')).toBe('run.gpx');
    expect(result.eventId).toBe('event-1');
  });

  it.each(['fetch', 'response', 'auth', 'app-check', 'no-abort-controller'])(
    'bounds a stalled %s stage and prevents late upload work', async stage => {
      vi.useFakeTimers();
      if (stage === 'no-abort-controller') vi.stubGlobal('AbortController', undefined);
      let resume!: (value: unknown) => void;
      const stalled = new Promise(resolve => { resume = resolve; });
      const json = vi.fn().mockResolvedValue({ eventId: 'event-1' });
      fetchMock.mockResolvedValue({ ok: true, status: 200, json });
      if (stage === 'auth') authMock.currentUser.getIdToken.mockReturnValue(stalled);
      else if (stage === 'app-check') vi.mocked(appCheckReadinessMock.getToken).mockReturnValue(stalled as Promise<string>);
      else if (stage === 'response') json.mockReturnValue(stalled);
      else fetchMock.mockReturnValue(stalled);

      let error: unknown;
      const upload = service.uploadFitFile(new Uint8Array([1]).buffer).catch(reason => { error = reason; });
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);
      expect(error).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(error).toMatchObject({ status: 408, code: 'upload_timeout' });
      expect((error as Error).message).toContain('Check your activities before uploading this file again');

      if (stage !== 'auth' && stage !== 'app-check' && stage !== 'no-abort-controller') {
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
      }
      resume(stage === 'auth' ? 'late-id-token' : stage === 'app-check' ? 'late-app-check-token' : { eventId: 'late-event' });
      await vi.advanceTimersByTimeAsync(0);
      await upload;
      if (stage === 'auth') expect(appCheckReadinessMock.getToken).not.toHaveBeenCalled();
      if (stage === 'auth' || stage === 'app-check') expect(fetchMock).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['success', 'failure'])('clears the deadline after %s without retrying', async outcome => {
    vi.useFakeTimers();
    if (outcome === 'success') fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ eventId: 'event-1' }) });
    else fetchMock.mockRejectedValue(new Error('Network unavailable'));

    const upload = service.uploadFitFile(new Uint8Array([1]).buffer);
    if (outcome === 'success') await expect(upload).resolves.toMatchObject({ eventId: 'event-1' });
    else await expect(upload).rejects.toThrow('Network unavailable');
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should normalize extension casing and omit blank original filename', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        eventId: 'event-1',
        activitiesCount: 1,
        uploadLimit: 10,
        uploadCountAfterWrite: 1,
      }),
    });

    const payload = new Uint8Array([1, 2, 3]).buffer;
    await service.uploadActivityFile(payload, '  GPX.GZ  ', '   ');

    const fetchOptions = fetchMock.mock.calls[0][1];
    const headers = fetchOptions.headers as Headers;
    expect(headers.get('X-File-Extension')).toBe('gpx.gz');
    expect(headers.get('X-Original-Filename')).toBeNull();
    expect(headers.get('X-Original-Filename-Encoded')).toBeNull();
  });

  it('should percent-encode unicode original filenames into a header-safe value', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        eventId: 'event-1',
        activitiesCount: 1,
        uploadLimit: 10,
        uploadCountAfterWrite: 1,
      }),
    });

    const payload = new Uint8Array([1, 2, 3]).buffer;
    const originalFilename = 'тренировка.fit';

    await service.uploadActivityFile(payload, 'fit', originalFilename);

    const fetchOptions = fetchMock.mock.calls[0][1];
    const headers = fetchOptions.headers as Headers;
    expect(headers.get('X-Original-Filename')).toBeNull();
    expect(headers.get('X-Original-Filename-Encoded')).toBe(encodeURIComponent(originalFilename));
  });

  it('should throw when user is not authenticated', async () => {
    authMock.currentUser = null;

    await expect(service.uploadFitFile(new Uint8Array([1]).buffer)).rejects.toThrow('authenticated');
  });

  it('should surface backend error messages', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: vi.fn().mockResolvedValue({ error: 'Upload limit reached.' }),
    });

    await expect(service.uploadFitFile(new Uint8Array([1]).buffer)).rejects.toMatchObject({
      message: 'Upload limit reached.',
      status: 429,
      code: 'quota_exceeded',
    } satisfies Partial<UploadError>);
  });

  it('should preserve backend upload error codes', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        error: 'Could not parse uploaded payload.',
        code: 'invalid_payload',
      }),
    });

    await expect(service.uploadFitFile(new Uint8Array([1]).buffer)).rejects.toMatchObject({
      message: 'Could not parse uploaded payload.',
      status: 400,
      code: 'invalid_payload',
    } satisfies Partial<UploadError>);
  });

  it('should surface account-deletion upload conflicts with their stable code', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: vi.fn().mockResolvedValue({
        error: 'Account deletion is in progress. Please sign in again.',
        code: 'user_deleted_or_deleting',
      }),
    });

    await expect(service.uploadFitFile(new Uint8Array([1]).buffer)).rejects.toMatchObject({
      message: 'Account deletion is in progress. Please sign in again.',
      status: 409,
      code: 'user_deleted_or_deleting',
    } satisfies Partial<UploadError>);
  });

  it('should provide a friendly message when backend returns non-JSON 500 response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token < in JSON at position 0')),
    });

    await expect(service.uploadFitFile(new Uint8Array([1]).buffer)).rejects.toThrow(
      'Upload service is temporarily unavailable. Please try again shortly.',
    );
  });

  it('should provide friendly fallback messages for non-JSON 401/429/400 responses', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: vi.fn().mockRejectedValue(new SyntaxError('not json')),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: vi.fn().mockRejectedValue(new SyntaxError('not json')),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: vi.fn().mockRejectedValue(new SyntaxError('not json')),
      });

    await expect(service.uploadFitFile(new Uint8Array([1]).buffer)).rejects.toThrow('sign in again');
    await expect(service.uploadFitFile(new Uint8Array([1]).buffer)).rejects.toThrow('Upload limit reached');
    await expect(service.uploadFitFile(new Uint8Array([1]).buffer)).rejects.toThrow('Could not process uploaded file');
  });

  it('should throw when app check token cannot be retrieved', async () => {
    appCheckReadinessMock.getToken = vi.fn().mockRejectedValueOnce(new Error('Could not retrieve App Check token.'));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AppFitUploadService,
        { provide: Auth, useValue: authMock },
        { provide: FirebaseApp, useValue: appMock },
        { provide: AppCheckReadinessService, useValue: appCheckReadinessMock },
      ],
    });
    service = TestBed.inject(AppFitUploadService);

    await expect(service.uploadFitFile(new Uint8Array([1]).buffer)).rejects.toThrow('App Check');
  });

  it('should throw when app check service is not configured', async () => {
    TestBed.resetTestingModule();
    const missingAppCheckReadiness = {
      getToken: vi.fn().mockRejectedValue(new Error('App Check is not configured for this app.')),
    };
    TestBed.configureTestingModule({
      providers: [
        AppFitUploadService,
        { provide: Auth, useValue: authMock },
        { provide: FirebaseApp, useValue: appMock },
        { provide: AppCheckReadinessService, useValue: missingAppCheckReadiness },
      ],
    });
    const serviceWithoutAppCheck = TestBed.inject(AppFitUploadService);

    await expect(serviceWithoutAppCheck.uploadFitFile(new Uint8Array([1]).buffer))
      .rejects
      .toThrow('App Check is not configured');
  });

  it('should throw when firebase project id is missing', async () => {
    appMock.options.projectId = '';
    await expect(service.uploadFitFile(new Uint8Array([1]).buffer))
      .rejects
      .toThrow('project ID');
  });

  it('should throw when extension is empty for uploadActivityFile', async () => {
    await expect(service.uploadActivityFile(new Uint8Array([1]).buffer, '')).rejects.toThrow('extension');
  });

  it('should use production upload URL when functions emulator is disabled', async () => {
    environment.useFunctionsEmulator = false;

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        eventId: 'event-1',
        activitiesCount: 1,
        uploadLimit: 10,
        uploadCountAfterWrite: 1,
      }),
    });

    await service.uploadActivityFile(new Uint8Array([1, 2, 3]).buffer, 'fit');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://europe-west2-quantified-self-io.cloudfunctions.net/uploadActivity',
      expect.any(Object),
    );
  });
});
