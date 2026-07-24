import { describe, expect, it, vi } from 'vitest';
import {
  AccessTokenRecord,
  AuthorizationCodeRecord,
  AuthorizationRequestRecord,
  ClientMetadata,
  createMcpOAuthService,
  createPkceChallenge,
  fetchClientMetadataDocument,
  hashOpaqueValue,
  isPrivateAddress,
  McpConnection,
  McpOAuthError,
  McpOAuthStore,
  MCP_OAUTH_SCOPES,
  RefreshTokenRecord,
} from './oauth.service';

function createMemoryStore(): McpOAuthStore & {
  requests: Map<string, AuthorizationRequestRecord>;
  codes: Map<string, AuthorizationCodeRecord>;
  accessTokens: Map<string, AccessTokenRecord>;
  refreshTokens: Map<string, RefreshTokenRecord & { active: boolean }>;
  connections: Map<string, McpConnection>;
} {
  const requests = new Map<string, AuthorizationRequestRecord>();
  const codes = new Map<string, AuthorizationCodeRecord>();
  const accessTokens = new Map<string, AccessTokenRecord>();
  const refreshTokens = new Map<string, RefreshTokenRecord & { active: boolean }>();
  const connections = new Map<string, McpConnection>();
  const connectionKey = (uid: string, connectionId: string) => `${uid}:${connectionId}`;

  return {
    requests,
    codes,
    accessTokens,
    refreshTokens,
    connections,
    async saveAuthorizationRequest(record) {
      requests.set(record.requestId, record);
    },
    async getAuthorizationRequest(requestId) {
      return requests.get(requestId) || null;
    },
    async approveAuthorization(input) {
      const request = requests.get(input.requestId);
      if (!request || request.status !== 'pending' || request.expiresAtMs <= input.nowMs) {
        throw new McpOAuthError('invalid_request', 'invalid request');
      }
      requests.set(input.requestId, { ...request, status: 'approved' });
      codes.set(input.codeHash, input.codeRecord);
      connections.set(connectionKey(input.uid, input.connection.connectionId), input.connection);
      return request;
    },
    async denyAuthorization(requestId, nowMs) {
      const request = requests.get(requestId);
      if (!request || request.status !== 'pending' || request.expiresAtMs <= nowMs) {
        throw new McpOAuthError('invalid_request', 'invalid request');
      }
      requests.set(requestId, { ...request, status: 'denied' });
      return request;
    },
    async exchangeAuthorizationCode(input) {
      const code = codes.get(input.codeHash);
      if (
        !code
        || code.expiresAtMs <= input.nowMs
        || code.clientId !== input.clientId
        || code.redirectUri !== input.redirectUri
        || code.audience !== input.audience
        || code.codeChallenge !== input.codeChallenge
      ) {
        throw new McpOAuthError('invalid_grant', 'invalid code');
      }
      codes.delete(input.codeHash);
      accessTokens.set(input.accessTokenHash, {
        ...input.accessTokenRecord,
        uid: code.uid,
        connectionId: code.connectionId,
        scopes: code.scopes,
      });
      refreshTokens.set(input.refreshTokenHash, {
        ...input.refreshTokenRecord,
        uid: code.uid,
        connectionId: code.connectionId,
        scopes: code.scopes,
        active: true,
      });
      return code;
    },
    async exchangeRefreshToken(input) {
      const refresh = refreshTokens.get(input.refreshTokenHash);
      if (
        !refresh
        || !refresh.active
        || refresh.expiresAtMs <= input.nowMs
        || refresh.clientId !== input.clientId
        || refresh.audience !== input.audience
        || input.requestedScopes?.some(scope => !refresh.scopes.includes(scope))
      ) {
        throw new McpOAuthError('invalid_grant', 'invalid refresh token');
      }
      refresh.active = false;
      const scopes = input.requestedScopes || refresh.scopes;
      accessTokens.set(input.nextAccessTokenHash, {
        ...input.nextAccessTokenRecord,
        uid: refresh.uid,
        connectionId: refresh.connectionId,
        scopes,
      });
      refreshTokens.set(input.nextRefreshTokenHash, {
        ...input.nextRefreshTokenRecord,
        uid: refresh.uid,
        connectionId: refresh.connectionId,
        scopes,
        familyId: refresh.familyId,
        active: true,
      });
      return refresh;
    },
    async getAccessToken(tokenHash) {
      return accessTokens.get(tokenHash) || null;
    },
    async getConnection(uid, connectionId) {
      return connections.get(connectionKey(uid, connectionId)) || null;
    },
    async recordAuthorizedRequest(_tokenHash, token, nowMs) {
      const key = connectionKey(token.uid, token.connectionId);
      const connection = connections.get(key);
      if (connection) {
        connections.set(key, { ...connection, lastUsedAtMs: nowMs });
      }
    },
    async listConnections(uid) {
      return [...connections.entries()]
        .filter(([key]) => key.startsWith(`${uid}:`))
        .map(([, connection]) => connection);
    },
    async revokeConnection(uid, connectionId, nowMs) {
      const key = connectionKey(uid, connectionId);
      const connection = connections.get(key);
      if (connection) {
        connections.set(key, { ...connection, revokedAtMs: nowMs });
      }
      for (const [hash, token] of accessTokens) {
        if (token.uid === uid && token.connectionId === connectionId) {
          accessTokens.delete(hash);
        }
      }
      for (const [hash, token] of refreshTokens) {
        if (token.uid === uid && token.connectionId === connectionId) {
          refreshTokens.delete(hash);
        }
      }
    },
  };
}

function metadata(): ClientMetadata {
  return {
    client_id: 'https://client.example/mcp.json',
    client_name: 'Example MCP Client',
    redirect_uris: ['https://client.example/oauth/callback'],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

function authorizationParams(verifier: string) {
  return {
    response_type: 'code',
    client_id: 'https://client.example/mcp.json',
    redirect_uri: 'https://client.example/oauth/callback',
    code_challenge: createPkceChallenge(verifier),
    code_challenge_method: 'S256',
    state: 'client-state',
    scope: 'metrics:read sleep:read',
    resource: 'https://quantified-self.io/mcp',
  };
}

describe('MCP OAuth service', () => {
  it('requires PKCE, the exact MCP resource, and an exact registered redirect', async () => {
    const store = createMemoryStore();
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn().mockResolvedValue(metadata()),
      now: () => 1000,
      randomToken: () => 'request-id',
    });
    const verifier = 'v'.repeat(43);

    await expect(service.startAuthorization({
      ...authorizationParams(verifier),
      code_challenge_method: 'plain',
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_request' });

    await expect(service.startAuthorization({
      ...authorizationParams(verifier),
      resource: 'https://other.example/mcp',
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_request' });

    await expect(service.startAuthorization({
      ...authorizationParams(verifier),
      redirect_uri: 'https://evil.example/callback',
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_client' });
  });

  it('issues one-time opaque tokens, rotates refresh tokens, and enforces audience binding', async () => {
    const store = createMemoryStore();
    let nowMs = 1000;
    const randomValues = [
      'request-id',
      'authorization-code',
      'connection-id',
      'access-token-1',
      'refresh-token-1',
      'family-id',
      'replay-access-token',
      'replay-refresh-token',
      'replay-family-id',
      'access-token-2',
      'refresh-token-2',
    ];
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn().mockResolvedValue(metadata()),
      now: () => nowMs,
      randomToken: () => randomValues.shift()!,
    });
    const verifier = 'correct-verifier-value-with-at-least-43-characters';

    const started = await service.startAuthorization(
      authorizationParams(verifier),
      'https://quantified-self.io',
    );
    expect(started.requestId).toBe('request-id');

    const approved = await service.decideAuthorization({
      uid: 'user-1',
      requestId: started.requestId,
      approved: true,
      grantedScopes: [MCP_OAUTH_SCOPES.MetricsRead, MCP_OAUTH_SCOPES.SleepRead],
    });
    const code = new URL(approved.redirectUri).searchParams.get('code')!;

    const tokens = await service.exchangeAuthorizationCode({
      grant_type: 'authorization_code',
      code,
      client_id: metadata().client_id,
      redirect_uri: metadata().redirect_uris[0],
      code_verifier: verifier,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io');
    expect(tokens).toEqual(expect.objectContaining({
      access_token: 'access-token-1',
      refresh_token: 'refresh-token-1',
      scope: 'metrics:read sleep:read',
    }));
    expect(store.accessTokens.has(hashOpaqueValue(tokens.access_token))).toBe(true);
    expect(store.codes.size).toBe(0);

    await expect(service.exchangeAuthorizationCode({
      code,
      client_id: metadata().client_id,
      redirect_uri: metadata().redirect_uris[0],
      code_verifier: verifier,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_grant' });

    nowMs += 100;
    const rotated = await service.exchangeRefreshToken({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: metadata().client_id,
      scope: 'metrics:read',
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io');
    expect(rotated).toEqual(expect.objectContaining({
      access_token: 'access-token-2',
      refresh_token: 'refresh-token-2',
      scope: 'metrics:read',
    }));
    expect(store.refreshTokens.get(hashOpaqueValue(tokens.refresh_token))?.active).toBe(false);

    await expect(service.authenticateBearer(
      rotated.access_token,
      'https://other.example/mcp',
    )).rejects.toMatchObject({ statusCode: 401 });

    await expect(service.authenticateBearer(
      rotated.access_token,
      'https://quantified-self.io/mcp',
    )).resolves.toEqual(expect.objectContaining({
      uid: 'user-1',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
    }));
  });

  it('rejects private and loopback client metadata targets before fetching', async () => {
    await expect(fetchClientMetadataDocument(
      'https://127.0.0.1/client.json',
    )).rejects.toMatchObject({ code: 'invalid_client' });
    await expect(fetchClientMetadataDocument(
      'https://localhost/client.json',
    )).rejects.toMatchObject({ code: 'invalid_client' });

    expect(isPrivateAddress('100.64.0.1')).toBe(true);
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::ffff:172.16.0.1')).toBe(true);
    expect(isPrivateAddress('fc00::1')).toBe(true);
    expect(isPrivateAddress('2001:db8::1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });

  it('revokes a connection and makes its access token unusable', async () => {
    const store = createMemoryStore();
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn(),
      now: () => 5000,
      randomToken: () => 'unused',
    });
    store.connections.set('user-1:connection-1', {
      connectionId: 'connection-1',
      clientId: metadata().client_id,
      clientName: metadata().client_name,
      redirectHost: 'client.example',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      createdAtMs: 1,
      lastUsedAtMs: null,
      revokedAtMs: null,
    });
    store.accessTokens.set(hashOpaqueValue('access-token'), {
      uid: 'user-1',
      connectionId: 'connection-1',
      clientId: metadata().client_id,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 1,
      expiresAtMs: 10000,
    });

    await service.revokeConnection('user-1', 'connection-1');

    await expect(service.listConnections('user-1')).resolves.toEqual([]);
    await expect(service.authenticateBearer(
      'access-token',
      'https://quantified-self.io/mcp',
    )).rejects.toMatchObject({ statusCode: 401 });
  });
});
