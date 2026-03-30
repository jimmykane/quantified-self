import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppFitUploadService } from './app.fit-upload.service';
import { FirebaseApp } from 'app/firebase/app';
import { Auth } from 'app/firebase/auth';
import { AppCheck } from 'app/firebase/app-check';

const hoisted = vi.hoisted(() => ({
  mockGetAppCheckToken: vi.fn(),
}));

vi.mock('app/firebase/app-check', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/firebase/app-check')>();
  return {
    ...actual,
    getToken: (...args: unknown[]) => hoisted.mockGetAppCheckToken(...args),
  };
});

describe('AppFitUploadService', () => {
  let service: AppFitUploadService;
  let authMock: any;
  let appMock: any;
  let appCheckMock: any;
  let fetchMock: any;

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
    appCheckMock = {};

    hoisted.mockGetAppCheckToken.mockResolvedValue({ token: 'app-check-token' });

    TestBed.configureTestingModule({
      providers: [
        AppFitUploadService,
        { provide: Auth, useValue: authMock },
        { provide: FirebaseApp, useValue: appMock },
        { provide: AppCheck, useValue: appCheckMock },
      ]
    });

    service = TestBed.inject(AppFitUploadService);
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

    expect(authMock.currentUser.getIdToken).toHaveBeenCalledWith(true);
    expect(hoisted.mockGetAppCheckToken).toHaveBeenCalledWith(appCheckMock, false);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://europe-west2-quantified-self-io.cloudfunctions.net/uploadActivity',
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

    await expect(service.uploadFitFile(new Uint8Array([1]).buffer)).rejects.toThrow('Upload limit reached.');
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
    hoisted.mockGetAppCheckToken.mockResolvedValueOnce({ token: '' });

    await expect(service.uploadFitFile(new Uint8Array([1]).buffer)).rejects.toThrow('App Check');
  });

  it('should throw when app check service is not configured', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AppFitUploadService,
        { provide: Auth, useValue: authMock },
        { provide: FirebaseApp, useValue: appMock },
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
});
