import { Injectable, inject } from '@angular/core';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS,
  SendRouteToServiceItemResult,
  SendRoutesToServiceRequest,
  SendRoutesToServiceResponse,
} from '@shared/saved-route-send';
import { AppFunctionsService } from './app.functions.service';

export interface RouteSendProgress {
  chunkIndex: number;
  chunkCount: number;
  processedRouteCount: number;
  routeCount: number;
}

export function getRouteSendErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  const code = (error as { code?: unknown } | null)?.code;
  const normalizedMessage = typeof message === 'string' ? message : '';
  const normalizedCode = typeof code === 'string' ? code : '';

  if (normalizedCode.includes('permission-denied')) {
    return 'Sending routes to services is a Pro feature.';
  }
  if (normalizedCode.includes('unauthenticated')) {
    return 'Connect Suunto again before sending routes.';
  }
  if (/not supported yet/i.test(normalizedMessage)) {
    return normalizedMessage;
  }
  if (/account is being deleted/i.test(normalizedMessage)) {
    return 'Account is being deleted or no longer exists.';
  }
  return normalizedMessage || 'Could not send routes to Suunto.';
}

@Injectable({
  providedIn: 'root',
})
export class AppRouteSendService {
  private functionsService = inject(AppFunctionsService);

  async sendRoutesToService(
    routeIds: string[],
    destinationServiceName: ServiceNames,
    options: { onProgress?: (progress: RouteSendProgress) => void } = {},
  ): Promise<SendRoutesToServiceResponse> {
    const uniqueRouteIds = Array.from(new Set(routeIds.map(routeId => `${routeId || ''}`.trim()).filter(Boolean)));
    if (uniqueRouteIds.length === 0) {
      throw new Error('Select at least one route to send.');
    }

    const chunks = this.chunkRouteIds(uniqueRouteIds);
    const responses: SendRoutesToServiceResponse[] = [];
    let processedRouteCount = 0;

    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      try {
        const response = await this.functionsService.call<SendRoutesToServiceRequest, SendRoutesToServiceResponse>(
          'sendRoutesToService',
          {
            routeIds: chunk,
            destinationServiceName,
          },
        );
        responses.push(response.data);
        processedRouteCount += chunk.length;
        options.onProgress?.({
          chunkIndex: index,
          chunkCount: chunks.length,
          processedRouteCount,
          routeCount: uniqueRouteIds.length,
        });
      } catch (error) {
        if (responses.length === 0) {
          throw error;
        }
        const unsentRouteIds = uniqueRouteIds.slice(processedRouteCount);
        responses.push(this.buildFailedChunkResponse(destinationServiceName, unsentRouteIds, error));
        break;
      }
    }

    return this.mergeResponses(destinationServiceName, uniqueRouteIds.length, responses);
  }

  private chunkRouteIds(routeIds: string[]): string[][] {
    const chunks: string[][] = [];
    for (let index = 0; index < routeIds.length; index += SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS) {
      chunks.push(routeIds.slice(index, index + SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS));
    }
    return chunks;
  }

  private buildFailedChunkResponse(
    destinationServiceName: ServiceNames,
    routeIds: string[],
    error: unknown,
  ): SendRoutesToServiceResponse {
    const message = getRouteSendErrorMessage(error);
    return {
      destinationServiceName,
      status: 'failure',
      routeCount: routeIds.length,
      successCount: 0,
      failureCount: routeIds.length,
      skippedCount: 0,
      results: routeIds.map(routeId => ({
        routeId,
        destinationServiceName,
        status: 'failure',
        reason: 'SEND_REQUEST_FAILED',
        message,
      })),
    };
  }

  private mergeResponses(
    destinationServiceName: ServiceNames,
    routeCount: number,
    responses: SendRoutesToServiceResponse[],
  ): SendRoutesToServiceResponse {
    const results = responses.flatMap(response => response.results) as SendRouteToServiceItemResult[];
    const successCount = results.filter(result => result.status === 'success').length;
    const skippedCount = results.filter(result => result.status === 'skipped').length;
    const failureCount = results.length - successCount - skippedCount;
    const status = successCount === routeCount
      ? 'success'
      : successCount > 0 ? 'partial_success' : 'failure';

    return {
      destinationServiceName,
      status,
      routeCount,
      successCount,
      failureCount,
      skippedCount,
      results,
    };
  }
}
