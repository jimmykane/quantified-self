import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirebaseApp } from 'app/firebase/app';
import { Auth } from 'app/firebase/auth';
import { AppCheckReadinessService } from './app-check-readiness.service';
import { AppRouteUploadService } from './app.route-upload.service';
import { environment } from '../../environments/environment';

describe('AppRouteUploadService', () => {
  let service: AppRouteUploadService;
  let authMock: any;
  let appMock: any;
  let appCheckReadinessMock: Pick<AppCheckReadinessService, 'getToken'>;
  let fetchMock: any;
  let originalLocalhost: boolean;
  let originalUseFunctionsEmulator: boolean;

  beforeEach(() => {
    originalLocalhost = environment.localhost;
    originalUseFunctionsEmulator = environment.useFunctionsEmulator;
    environment.localhost = true;
    environment.useFunctionsEmulator = true;

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
        AppRouteUploadService,
        { provide: Auth, useValue: authMock },
        { provide: FirebaseApp, useValue: appMock },
        { provide: AppCheckReadinessService, useValue: appCheckReadinessMock },
      ],
    });

    service = TestBed.inject(AppRouteUploadService);
  });

  afterEach(() => {
    environment.localhost = originalLocalhost;
    environment.useFunctionsEmulator = originalUseFunctionsEmulator;
  });

  it('uploads route bytes to uploadRoute with auth, app check, extension, and filename headers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        routeId: 'route-1',
        routesCount: 1,
        routeCount: 1,
        duplicate: true,
        uploadLimit: 10,
        uploadCountAfterWrite: 1,
      }),
    });

    const payload = new Uint8Array([1, 2, 3]).buffer;
    const result = await service.uploadRouteFile(payload, ' GPX.GZ ', 'morning-route.gpx');

    expect(authMock.currentUser.getIdToken).toHaveBeenCalledWith(true);
    expect(appCheckReadinessMock.getToken).toHaveBeenCalledWith();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5001/quantified-self-io/europe-west2/uploadRoute',
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
    expect(headers.get('X-Original-Filename')).toBe('morning-route.gpx');
    expect(headers.get('X-Original-Filename-Encoded')).toBe('morning-route.gpx');
    expect(result.routeId).toBe('route-1');
    expect(result.duplicate).toBe(true);
  });

  it('uses only encoded filename header when the original route filename contains unicode', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        routeId: 'route-1',
        routesCount: 1,
        routeCount: 1,
        uploadLimit: 10,
        uploadCountAfterWrite: 1,
      }),
    });

    const originalFilename = 'маршрут.fit';
    await service.uploadFitRouteFile(new Uint8Array([1]).buffer, originalFilename);

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('X-Original-Filename')).toBeNull();
    expect(headers.get('X-Original-Filename-Encoded')).toBe(encodeURIComponent(originalFilename));
  });

  it('throws when user is not authenticated', async () => {
    authMock.currentUser = null;

    await expect(service.uploadGPXRouteFile(new Uint8Array([1]).buffer)).rejects.toThrow('authenticated');
  });

  it('surfaces backend errors and friendly fallback messages', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: vi.fn().mockResolvedValue({ error: 'Route limit reached.' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new SyntaxError('not json')),
      });

    await expect(service.uploadFitRouteFile(new Uint8Array([1]).buffer)).rejects.toThrow('Route limit reached.');
    await expect(service.uploadFitRouteFile(new Uint8Array([1]).buffer)).rejects.toThrow(
      'Route upload service is temporarily unavailable. Please try again shortly.',
    );
  });
});
