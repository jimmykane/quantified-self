import { TestBed } from '@angular/core/testing';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS } from '@shared/saved-route-send';
import { AppFunctionsService } from './app.functions.service';
import {
  AppRouteSendService,
  getRouteSendErrorMessage,
  getRouteSendResponseMessage,
} from './app.route-send.service';

describe('AppRouteSendService', () => {
  let service: AppRouteSendService;
  let functionsServiceMock: { call: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    functionsServiceMock = {
      call: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        AppRouteSendService,
        { provide: AppFunctionsService, useValue: functionsServiceMock },
      ],
    });

    service = TestBed.inject(AppRouteSendService);
  });

  it('calls the generic send callable and returns the response', async () => {
    functionsServiceMock.call.mockResolvedValueOnce({
      data: {
        destinationServiceName: ServiceNames.SuuntoApp,
        status: 'success',
        routeCount: 1,
        successCount: 1,
        failureCount: 0,
        skippedCount: 0,
        results: [{ routeId: 'route-1', destinationServiceName: ServiceNames.SuuntoApp, status: 'success' }],
      },
    });

    const result = await service.sendRoutesToService(['route-1'], ServiceNames.SuuntoApp);

    expect(functionsServiceMock.call).toHaveBeenCalledWith('sendRoutesToService', {
      routeIds: ['route-1'],
      destinationServiceName: ServiceNames.SuuntoApp,
    });
    expect(result.status).toBe('success');
    expect(result.successCount).toBe(1);
  });

  it('chunks route ids and aggregates partial successes', async () => {
    const routeIds = Array.from({ length: SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS + 1 }, (_value, index) => `route-${index + 1}`);
    functionsServiceMock.call
      .mockResolvedValueOnce({
        data: {
          destinationServiceName: ServiceNames.SuuntoApp,
          status: 'success',
          routeCount: SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS,
          successCount: SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS,
          failureCount: 0,
          skippedCount: 0,
          results: routeIds.slice(0, SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS).map(routeId => ({
            routeId,
            destinationServiceName: ServiceNames.SuuntoApp,
            status: 'success',
          })),
        },
      })
      .mockResolvedValueOnce({
        data: {
          destinationServiceName: ServiceNames.SuuntoApp,
          status: 'failure',
          routeCount: 1,
          successCount: 0,
          failureCount: 1,
          skippedCount: 0,
          results: [{
            routeId: routeIds[routeIds.length - 1],
            destinationServiceName: ServiceNames.SuuntoApp,
            status: 'failure',
            reason: 'PROVIDER_ERROR',
          }],
        },
      });
    const progressSpy = vi.fn();

    const result = await service.sendRoutesToService(routeIds, ServiceNames.SuuntoApp, { onProgress: progressSpy });

    expect(functionsServiceMock.call).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('partial_success');
    expect(result.routeCount).toBe(SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS + 1);
    expect(result.successCount).toBe(SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS);
    expect(result.failureCount).toBe(1);
    expect(progressSpy).toHaveBeenLastCalledWith({
      chunkIndex: 1,
      chunkCount: 2,
      processedRouteCount: SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS + 1,
      routeCount: SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS + 1,
    });
  });

  it('preserves completed chunk results when a later chunk request fails', async () => {
    const routeIds = Array.from({ length: SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS + 1 }, (_value, index) => `route-${index + 1}`);
    functionsServiceMock.call
      .mockResolvedValueOnce({
        data: {
          destinationServiceName: ServiceNames.SuuntoApp,
          status: 'success',
          routeCount: SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS,
          successCount: SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS,
          failureCount: 0,
          skippedCount: 0,
          results: routeIds.slice(0, SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS).map(routeId => ({
            routeId,
            destinationServiceName: ServiceNames.SuuntoApp,
            status: 'success',
          })),
        },
      })
      .mockRejectedValueOnce({ code: 'functions/unavailable', message: 'Service temporarily unavailable.' });

    const result = await service.sendRoutesToService(routeIds, ServiceNames.SuuntoApp);

    expect(functionsServiceMock.call).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('partial_success');
    expect(result.routeCount).toBe(SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS + 1);
    expect(result.successCount).toBe(SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS);
    expect(result.failureCount).toBe(1);
    expect(result.results.at(-1)).toEqual({
      routeId: routeIds[routeIds.length - 1],
      destinationServiceName: ServiceNames.SuuntoApp,
      status: 'failure',
      reason: 'SEND_REQUEST_FAILED',
      message: 'Service temporarily unavailable.',
    });
  });

  it('maps common route send errors to user-facing messages', () => {
    expect(getRouteSendErrorMessage({ code: 'functions/permission-denied' })).toBe('Sending routes to services is a Pro feature.');
    expect(getRouteSendErrorMessage({ code: 'functions/unauthenticated' })).toBe('Sending routes is not authorized. Please sign in again.');
    expect(getRouteSendErrorMessage({
      code: 'functions/unauthenticated',
      message: 'No connected Suunto account found',
    })).toBe('Connect Suunto again before sending routes.');
    expect(getRouteSendErrorMessage({ message: 'Sending saved routes to GarminAPI is not supported yet.' }))
      .toBe('Sending saved routes to GarminAPI is not supported yet.');
    expect(getRouteSendErrorMessage({ message: 'Could not verify account state. Please retry.' }))
      .toBe('Could not verify account state. Please retry.');
  });

  it('maps route send responses with auth-required failures to reconnect guidance', () => {
    expect(getRouteSendResponseMessage({
      destinationServiceName: ServiceNames.SuuntoApp,
      status: 'failure',
      routeCount: 1,
      successCount: 0,
      failureCount: 1,
      skippedCount: 0,
      results: [{
        routeId: 'route-1',
        destinationServiceName: ServiceNames.SuuntoApp,
        status: 'failure',
        reason: 'DESTINATION_AUTH_REQUIRED',
        message: 'Authentication failed. Please re-connect your Suunto account.',
      }],
    })).toBe('Connect Suunto again before sending routes.');
  });

  it('prefers account-state guidance when the callable returns in-band account failures', () => {
    expect(getRouteSendResponseMessage({
      destinationServiceName: ServiceNames.SuuntoApp,
      status: 'failure',
      routeCount: 2,
      successCount: 0,
      failureCount: 2,
      skippedCount: 0,
      results: [
        {
          routeId: 'route-1',
          destinationServiceName: ServiceNames.SuuntoApp,
          status: 'failure',
          reason: 'ACCOUNT_STATE_UNAVAILABLE',
          message: 'Could not verify account state. Please retry.',
        },
        {
          routeId: 'route-2',
          destinationServiceName: ServiceNames.SuuntoApp,
          status: 'failure',
          reason: 'ACCOUNT_STATE_UNAVAILABLE',
          message: 'Could not verify account state. Please retry.',
        },
      ],
    })).toBe('Could not verify account state. Please retry.');
  });
});
