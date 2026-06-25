import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import {
  SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS,
  SendRouteToServiceItemResult,
  SendRoutesToServiceRequest,
  SendRoutesToServiceResponse,
} from '../../../shared/saved-route-send';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import { ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS } from '../shared/route-processing-config';
import {
  assertRouteSendUserActive,
  buildRouteSendFailureResult,
  buildSendRoutesResponse,
  buildTerminalRouteSendResults,
  buildUnattemptedRouteSendResultsAfterDeliveryMetadataFailure,
  getRouteSendAdapter,
  isAccountDeletionSkipError,
  isDeliveryMetadataPersistenceError,
  isDestinationAuthRequiredError,
  isDestinationPermissionRequiredError,
  isUserDeletionGuardReadError,
  persistRouteDeliveryMetadataAfterSend,
  prepareSavedRouteForSending,
  sendPreparedRouteToDestination,
} from './route-send-core';

export const sendRoutesToService = onCall({
  region: FUNCTIONS_MANIFEST.sendRoutesToService.region,
  ...ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS,
  cors: ALLOWED_CORS_ORIGINS,
}, async (request): Promise<SendRoutesToServiceResponse> => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  enforceAppCheck(request);

  const userID = request.auth.uid;
  const payload = normalizeSendRoutesRequest(request.data as Partial<SendRoutesToServiceRequest> | undefined);
  const adapter = getRouteSendAdapter(payload.destinationServiceName);
  if (!adapter) {
    throw new HttpsError('failed-precondition', `Sending saved routes to ${payload.destinationServiceName} is not supported yet.`);
  }

  if (!(await hasProAccess(userID))) {
    logger.warn(`Blocking saved route send for non-pro user ${userID}`);
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }

  try {
    await assertRouteSendUserActive(userID, 'before_destination_context');
    const results: SendRouteToServiceItemResult[] = [];
    let context: unknown;
    try {
      context = await adapter.createContext(userID);
    } catch (error) {
      return buildSendRoutesResponse(
        adapter.destinationServiceName,
        buildTerminalRouteSendResults(payload.routeIds, adapter.destinationServiceName, error),
      );
    }

    for (let index = 0; index < payload.routeIds.length; index++) {
      const routeId = payload.routeIds[index];
      try {
        await assertRouteSendUserActive(userID, 'before_route_prepare');
        const preparedRoute = await prepareSavedRouteForSending(userID, routeId);
        await assertRouteSendUserActive(userID, 'before_provider_upload');
        const providerResult = await sendPreparedRouteToDestination(userID, preparedRoute, adapter, context);
        await persistRouteDeliveryMetadataAfterSend({
          userID,
          routeID: routeId,
          destinationServiceName: adapter.destinationServiceName,
          providerRouteId: providerResult.providerRouteId,
          deliveries: providerResult.deliveries,
        });
        results.push({
          routeId,
          destinationServiceName: adapter.destinationServiceName,
          status: 'success',
          providerRouteId: providerResult.providerRouteId,
        });
      } catch (error) {
        if (isAccountDeletionSkipError(error) || isUserDeletionGuardReadError(error)) {
          results.push(...buildTerminalRouteSendResults(
            payload.routeIds.slice(index),
            adapter.destinationServiceName,
            error,
          ));
          break;
        }
        if (isDestinationAuthRequiredError(error)) {
          results.push(...buildTerminalRouteSendResults(
            payload.routeIds.slice(index),
            adapter.destinationServiceName,
            error,
          ));
          break;
        }
        if (isDestinationPermissionRequiredError(error)) {
          results.push(...buildTerminalRouteSendResults(
            payload.routeIds.slice(index),
            adapter.destinationServiceName,
            error,
          ));
          break;
        }
        if (isDeliveryMetadataPersistenceError(error)) {
          results.push(buildRouteSendFailureResult(routeId, adapter.destinationServiceName, error));
          results.push(...buildUnattemptedRouteSendResultsAfterDeliveryMetadataFailure(
            payload.routeIds.slice(index + 1),
            adapter.destinationServiceName,
          ));
          break;
        }
        results.push(buildRouteSendFailureResult(routeId, adapter.destinationServiceName, error));
      }
    }

    return buildSendRoutesResponse(adapter.destinationServiceName, results);
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    if (isUserDeletionGuardReadError(error)) {
      logger.error('[sendRoutesToService] Could not verify account deletion state', {
        userID,
        destinationServiceName: payload.destinationServiceName,
        error,
      });
      throw new HttpsError('unavailable', 'Could not verify account state. Please retry.');
    }
    if (isAccountDeletionSkipError(error)) {
      throw new HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
    }

    logger.error('[sendRoutesToService] Failed to send saved routes', {
      userID,
      destinationServiceName: payload.destinationServiceName,
      routeCount: payload.routeIds.length,
      error,
    });
    throw new HttpsError('internal', 'Could not send routes to the selected service.');
  }
});

function normalizeSendRoutesRequest(payload: Partial<SendRoutesToServiceRequest> | undefined): SendRoutesToServiceRequest {
  const destinationServiceName = payload?.destinationServiceName;
  if (!destinationServiceName) {
    throw new HttpsError('invalid-argument', 'destinationServiceName is required.');
  }

  const routeIds = Array.from(new Set(
    (Array.isArray(payload?.routeIds) ? payload.routeIds : [])
      .map(routeId => `${routeId || ''}`.trim())
      .filter(Boolean),
  ));

  if (routeIds.length === 0) {
    throw new HttpsError('invalid-argument', 'At least one routeId is required.');
  }

  if (routeIds.length > SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS) {
    throw new HttpsError('invalid-argument', `Send at most ${SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS} routes at a time.`);
  }

  return {
    destinationServiceName,
    routeIds,
  };
}
