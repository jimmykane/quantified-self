import { Injectable, inject } from '@angular/core';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS,
  SendRouteToServiceFailureReason,
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

const ROUTE_SEND_REASON_PRIORITY: SendRouteToServiceFailureReason[] = [
  'DESTINATION_AUTH_REQUIRED',
  'ACCOUNT_DELETION_IN_PROGRESS',
  'ACCOUNT_STATE_UNAVAILABLE',
  'SEND_REQUEST_FAILED',
  'SOURCE_SERVICE_BLOCKED',
  'SOURCE_FILE_UNAVAILABLE',
  'PARSE_FAILED',
  'NOT_FOUND',
  'NO_ORIGINAL_FILES',
  'PROVIDER_ERROR',
  'UNSUPPORTED_DESTINATION',
];

const TERMINAL_IN_BAND_ROUTE_SEND_REASONS: readonly SendRouteToServiceFailureReason[] = [
  'ACCOUNT_DELETION_IN_PROGRESS',
  'ACCOUNT_STATE_UNAVAILABLE',
  'DESTINATION_AUTH_REQUIRED',
];

const GENERIC_ROUTE_SEND_RESPONSE_MESSAGES = new Set<string>([
  'Could not send route.',
  'Could not send routes to Suunto.',
  'Could not send routes to the selected service.',
]);

export function getRouteSendErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  const code = (error as { code?: unknown } | null)?.code;
  const normalizedMessage = typeof message === 'string' ? message : '';
  const normalizedCode = typeof code === 'string' ? code : '';

  if (normalizedCode.includes('permission-denied')) {
    return 'Sending routes to services is a Pro feature.';
  }
  if (normalizedCode.includes('unauthenticated')) {
    return isDestinationAuthReconnectMessage(normalizedMessage)
      ? 'Connect Suunto again before sending routes.'
      : 'Sending routes is not authorized. Please sign in again.';
  }
  if (/not supported yet/i.test(normalizedMessage)) {
    return normalizedMessage;
  }
  if (/account is being deleted/i.test(normalizedMessage)) {
    return 'Account is being deleted or no longer exists.';
  }
  if (/could not verify account state/i.test(normalizedMessage)) {
    return 'Could not verify account state. Please retry.';
  }
  return normalizedMessage || 'Could not send routes to Suunto.';
}

export function getRouteSendResponseMessage(response: SendRoutesToServiceResponse): string {
  const nonSuccessResults = response.results.filter(result => result.status !== 'success');
  const highestPriorityReason = ROUTE_SEND_REASON_PRIORITY.find(reason =>
    nonSuccessResults.some(result => result.reason === reason),
  );

  switch (highestPriorityReason) {
    case 'DESTINATION_AUTH_REQUIRED':
      return getDestinationAuthRequiredMessage(response.destinationServiceName);
    case 'ACCOUNT_DELETION_IN_PROGRESS':
      return 'Account is being deleted or no longer exists.';
    case 'ACCOUNT_STATE_UNAVAILABLE':
      return 'Could not verify account state. Please retry.';
    case 'SOURCE_SERVICE_BLOCKED':
      return nonSuccessResults.find(result =>
        result.reason === 'SOURCE_SERVICE_BLOCKED'
          && typeof result.message === 'string'
          && result.message.trim().length > 0,
      )?.message?.trim() || 'Routes imported from Suunto are already there and cannot be sent back to Suunto.';
    default:
      return nonSuccessResults.find(result => typeof result.message === 'string' && result.message.trim())?.message?.trim()
        || getDefaultRouteSendFailureMessage(response.destinationServiceName);
  }
}

export function getActionableRouteSendResponseMessage(response: SendRoutesToServiceResponse): string | null {
  const hasNonSuccessResults = response.results.some(result => result.status !== 'success');
  if (!hasNonSuccessResults) {
    return null;
  }

  const message = getRouteSendResponseMessage(response);
  return GENERIC_ROUTE_SEND_RESPONSE_MESSAGES.has(message) ? null : message;
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

        const terminalChunkResult = this.getTerminalInBandChunkResult(response.data);
        if (terminalChunkResult) {
          const unsentRouteIds = uniqueRouteIds.slice(processedRouteCount);
          if (unsentRouteIds.length > 0) {
            responses.push(this.buildTerminalInBandResponse(
              destinationServiceName,
              unsentRouteIds,
              terminalChunkResult,
            ));
          }
          break;
        }
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

  private getTerminalInBandChunkResult(
    response: SendRoutesToServiceResponse,
  ): SendRouteToServiceItemResult | null {
    for (const reason of TERMINAL_IN_BAND_ROUTE_SEND_REASONS) {
      const match = response.results.find(result => result.reason === reason);
      if (match) {
        return match;
      }
    }

    return null;
  }

  private buildTerminalInBandResponse(
    destinationServiceName: ServiceNames,
    routeIds: string[],
    terminalResult: SendRouteToServiceItemResult,
  ): SendRoutesToServiceResponse {
    return {
      destinationServiceName,
      status: terminalResult.status === 'success' ? 'success' : 'failure',
      routeCount: routeIds.length,
      successCount: terminalResult.status === 'success' ? routeIds.length : 0,
      failureCount: terminalResult.status === 'failure' ? routeIds.length : 0,
      skippedCount: terminalResult.status === 'skipped' ? routeIds.length : 0,
      results: routeIds.map(routeId => ({
        routeId,
        destinationServiceName,
        status: terminalResult.status,
        reason: terminalResult.reason,
        message: terminalResult.message,
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

function getDestinationAuthRequiredMessage(destinationServiceName: ServiceNames): string {
  switch (destinationServiceName) {
    case ServiceNames.SuuntoApp:
      return 'Connect Suunto again before sending routes.';
    default:
      return 'Reconnect the selected service before sending routes.';
  }
}

function getDefaultRouteSendFailureMessage(destinationServiceName: ServiceNames): string {
  switch (destinationServiceName) {
    case ServiceNames.SuuntoApp:
      return 'Could not send routes to Suunto.';
    default:
      return 'Could not send routes to the selected service.';
  }
}

function isDestinationAuthReconnectMessage(message: string): boolean {
  return /suunto/i.test(message)
    || /no connected .*account/i.test(message)
    || /re-?connect/i.test(message);
}
