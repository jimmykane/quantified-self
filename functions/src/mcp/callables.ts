import { HttpsError, onCall } from 'firebase-functions/v2/https';
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
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
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
    return await getOAuthService().decideAuthorization({
      uid,
      requestId: `${data.requestId || ''}`,
      approved: data.approved === true,
      grantedScopes: Array.isArray(data.grantedScopes)
        ? data.grantedScopes.map(scope => `${scope}`)
        : undefined,
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
