import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { enforceAppCheck } from '../utils';
import { createMcpOAuthService, McpOAuthError } from './oauth.service';

let oauthService: ReturnType<typeof createMcpOAuthService> | null = null;

function getOAuthService(): ReturnType<typeof createMcpOAuthService> {
  oauthService ||= createMcpOAuthService();
  return oauthService;
}

function requireAuthenticatedRequest(request: {
  auth?: { uid: string } | null;
  app?: unknown;
}): string {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }
  enforceAppCheck(request);
  return request.auth.uid;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export interface McpAuthorizationDecision {
  approved: boolean;
  grantedScopes?: string[];
}

export function parseMcpAuthorizationDecision(value: unknown): McpAuthorizationDecision {
  const data = asRecord(value);
  if (typeof data.approved !== 'boolean') {
    throw new HttpsError('invalid-argument', 'approved must be a boolean.');
  }
  if (
    data.grantedScopes !== undefined
    && (
      !Array.isArray(data.grantedScopes)
      || data.grantedScopes.some(scope => typeof scope !== 'string')
    )
  ) {
    throw new HttpsError('invalid-argument', 'grantedScopes must be an array of strings.');
  }
  return {
    approved: data.approved,
    grantedScopes: data.grantedScopes as string[] | undefined,
  };
}

function toHttpsError(error: unknown): never {
  if (error instanceof HttpsError) {
    throw error;
  }
  if (error instanceof McpOAuthError) {
    const code = error.code === 'access_denied'
      ? 'permission-denied'
      : error.code === 'temporarily_unavailable'
        ? 'unavailable'
        : 'invalid-argument';
    throw new HttpsError(code, error.message);
  }
  logger.error('[MCP] Callable request failed unexpectedly', {
    errorName: error instanceof Error ? error.name : 'unknown',
  });
  throw new HttpsError('internal', 'The MCP connection request could not be completed.');
}

export const getMcpAuthorizationRequest = onCall({
  region: FUNCTIONS_MANIFEST.getMcpAuthorizationRequest.region,
}, async (request) => {
  requireAuthenticatedRequest(request);
  try {
    const data = asRecord(request.data);
    return await getOAuthService().getConsentDetails(`${data.requestId || ''}`);
  } catch (error) {
    return toHttpsError(error);
  }
});

export const decideMcpAuthorization = onCall({
  region: FUNCTIONS_MANIFEST.decideMcpAuthorization.region,
}, async (request) => {
  const uid = requireAuthenticatedRequest(request);
  try {
    const data = asRecord(request.data);
    const decision = parseMcpAuthorizationDecision(data);
    return await getOAuthService().decideAuthorization({
      uid,
      requestId: `${data.requestId || ''}`,
      ...decision,
    });
  } catch (error) {
    return toHttpsError(error);
  }
});

export const listMcpConnections = onCall({
  region: FUNCTIONS_MANIFEST.listMcpConnections.region,
}, async (request) => {
  const uid = requireAuthenticatedRequest(request);
  try {
    return {
      connections: await getOAuthService().listConnections(uid),
    };
  } catch (error) {
    return toHttpsError(error);
  }
});

export const revokeMcpConnection = onCall({
  region: FUNCTIONS_MANIFEST.revokeMcpConnection.region,
}, async (request) => {
  const uid = requireAuthenticatedRequest(request);
  try {
    const data = asRecord(request.data);
    await getOAuthService().revokeConnection(uid, `${data.connectionId || ''}`);
    return { revoked: true };
  } catch (error) {
    return toHttpsError(error);
  }
});
