import type { LookupAddress } from 'node:dns';
import { describe, expect, it, vi } from 'vitest';
import {
  AccessTokenRecord,
  AuthorizationCodeRecord,
  AuthorizationRequestRecord,
  buildMcpLogicalConnectionId,
  buildMcpRateLimitBucketId,
  ClientMetadata,
  createPinnedAddressLookup,
  createMcpOAuthService,
  createPkceChallenge,
  fetchClientMetadataDocument,
  hasValidMcpScopeDependencies,
  hashOpaqueValue,
  isPrivateAddress,
  McpConnection,
  McpOAuthAuthorizationRedirectError,
  McpOAuthError,
  McpOAuthStore,
  MCP_OAUTH_SCOPES,
  normalizeOAuthScopes,
  RefreshTokenRecord,
  validateClientMetadataDocument,
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
    async consumeAuthorizationStartRateLimit() {
      return;
    },
    async consumeRevocationRateLimit() {
      return;
    },
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
      const key = connectionKey(input.uid, input.connection.connectionId);
      const existingConnection = connections.get(key);
      if (
        existingConnection
        && existingConnection.clientId !== input.connection.clientId
      ) {
        throw new McpOAuthError('invalid_request', 'connection identity conflict');
      }
      requests.set(input.requestId, { ...request, status: 'approved' });
      codes.set(input.codeHash, input.codeRecord);
      if (
        !existingConnection
        || (
          existingConnection.revokedAtMs === null
          && existingConnection.lastUsedAtMs === null
          && (
            existingConnection.status === 'pending'
            || existingConnection.status === undefined
          )
        )
      ) {
        connections.set(key, {
          ...input.connection,
          status: 'pending',
          pendingAuthorizationCodeHash: input.codeHash,
          pendingAuthorizationApprovedAtMs: input.nowMs,
          pendingAuthorizationExpiresAtMs: input.codeRecord.expiresAtMs,
        });
      } else {
        connections.set(key, {
          ...existingConnection,
          pendingAuthorizationCodeHash: input.codeHash,
          pendingAuthorizationApprovedAtMs: input.nowMs,
          pendingAuthorizationExpiresAtMs: input.codeRecord.expiresAtMs,
        });
      }
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
      const key = connectionKey(code.uid, code.connectionId);
      const connection = connections.get(key);
      const isLogicalConnection = code.connectionId
        === buildMcpLogicalConnectionId(code.clientId);
      if (
        !connection
        || connection.clientId !== code.clientId
        || (
          isLogicalConnection
            ? (
              connection.pendingAuthorizationCodeHash !== input.codeHash
              || Number(connection.pendingAuthorizationExpiresAtMs || 0) <= input.nowMs
            )
            : (
              connection.revokedAtMs !== null
              || !(
                connection.lastUsedAtMs === null
                && (connection.status === 'pending' || connection.status === undefined)
              )
            )
        )
      ) {
        throw new McpOAuthError('invalid_grant', 'connection unavailable');
      }
      const grantId = input.refreshTokenRecord.familyId;
      codes.delete(input.codeHash);
      accessTokens.set(input.accessTokenHash, {
        ...input.accessTokenRecord,
        uid: code.uid,
        connectionId: code.connectionId,
        grantId,
        scopes: code.scopes,
      });
      refreshTokens.set(input.refreshTokenHash, {
        ...input.refreshTokenRecord,
        uid: code.uid,
        connectionId: code.connectionId,
        scopes: code.scopes,
        active: true,
      });
      connections.set(key, {
        ...connection,
        clientName: code.clientName || connection.clientName,
        redirectHost: code.redirectHost || connection.redirectHost,
        scopes: code.scopes,
        audience: code.audience,
        grantId,
        supersedesLegacy: isLogicalConnection || connection.supersedesLegacy === true,
        createdAtMs: input.nowMs,
        status: 'active',
        lastUsedAtMs: input.nowMs,
        revokedAtMs: null,
        pendingAuthorizationCodeHash: undefined,
        pendingAuthorizationApprovedAtMs: undefined,
        pendingAuthorizationExpiresAtMs: undefined,
      });
      return code;
    },
    async exchangeRefreshToken(input) {
      const refresh = refreshTokens.get(input.refreshTokenHash);
      if (
        !refresh
        || refresh.expiresAtMs <= input.nowMs
        || refresh.clientId !== input.clientId
        || refresh.audience !== input.audience
      ) {
        throw new McpOAuthError('invalid_grant', 'invalid refresh token');
      }
      const key = connectionKey(refresh.uid, refresh.connectionId);
      const connection = connections.get(key);
      const logicalConnectionId = buildMcpLogicalConnectionId(refresh.clientId);
      const logicalConnection = refresh.connectionId === logicalConnectionId
        ? connection
        : connections.get(connectionKey(refresh.uid, logicalConnectionId));
      if (
        connection?.clientId !== refresh.clientId
        || (
          logicalConnection
          && logicalConnection.clientId !== refresh.clientId
        )
      ) {
        throw new McpOAuthError('invalid_grant', 'invalid client binding');
      }
      if (
        logicalConnection?.supersedesLegacy === true
        && logicalConnection.connectionId !== refresh.connectionId
      ) {
        throw new McpOAuthError('invalid_grant', 'superseded connection');
      }
      if (
        !connection
        || connection.revokedAtMs !== null
        || !(
          connection.status === 'active'
          || (
            (connection.status === undefined || connection.status === 'pending')
            && connection.lastUsedAtMs !== null
          )
        )
      ) {
        throw new McpOAuthError('invalid_grant', 'inactive connection');
      }
      if (
        (
          refresh.connectionId === logicalConnectionId
          || connection.supersedesLegacy === true
        )
          ? (
            typeof connection.grantId !== 'string'
            || connection.grantId.length === 0
            || connection.grantId !== refresh.familyId
          )
          : (
            connection.grantId !== undefined
            && connection.grantId !== refresh.familyId
          )
      ) {
        throw new McpOAuthError('invalid_grant', 'superseded grant');
      }
      if (!refresh.active) {
        connections.set(key, {
          ...connection,
          status: 'revoked',
          revokedAtMs: input.nowMs,
        });
        throw new McpOAuthError('invalid_grant', 'refresh-token reuse');
      }
      if (input.requestedScopes?.some(scope => !refresh.scopes.includes(scope))) {
        throw new McpOAuthError('invalid_scope', 'scope exceeds grant');
      }
      refresh.active = false;
      const scopes = input.requestedScopes || refresh.scopes;
      accessTokens.set(input.nextAccessTokenHash, {
        ...input.nextAccessTokenRecord,
        uid: refresh.uid,
        connectionId: refresh.connectionId,
        grantId: refresh.familyId,
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
      connections.set(key, {
        ...connection,
        status: 'active',
        scopes,
        lastUsedAtMs: input.nowMs,
      });
      return refresh;
    },
    async getAccessToken(tokenHash) {
      return accessTokens.get(tokenHash) || null;
    },
    async getConnection(uid, connectionId) {
      return connections.get(connectionKey(uid, connectionId)) || null;
    },
    async recordAuthorizedRequest(token, nowMs) {
      const key = connectionKey(token.uid, token.connectionId);
      const connection = connections.get(key);
      const logicalConnectionId = buildMcpLogicalConnectionId(token.clientId);
      const logicalConnection = token.connectionId === logicalConnectionId
        ? connection
        : connections.get(connectionKey(token.uid, logicalConnectionId));
      if (
        connection?.clientId !== token.clientId
        || (
          logicalConnection
          && logicalConnection.clientId !== token.clientId
        )
      ) {
        throw new McpOAuthError('invalid_grant', 'invalid client binding', 401);
      }
      if (
        logicalConnection?.supersedesLegacy === true
        && logicalConnection.connectionId !== token.connectionId
      ) {
        throw new McpOAuthError('invalid_grant', 'superseded connection', 401);
      }
      if (
        !connection
        || connection.revokedAtMs !== null
        || !(
          connection.status === 'active'
          || (
            (connection.status === undefined || connection.status === 'pending')
            && connection.lastUsedAtMs !== null
          )
        )
      ) {
        throw new McpOAuthError('invalid_grant', 'inactive connection', 401);
      }
      if (
        (
          token.connectionId === logicalConnectionId
          || connection.supersedesLegacy === true
        )
          ? (
            typeof connection.grantId !== 'string'
            || connection.grantId.length === 0
            || connection.grantId !== token.grantId
          )
          : (
            connection.grantId !== undefined
            && connection.grantId !== token.grantId
          )
      ) {
        throw new McpOAuthError('invalid_grant', 'superseded grant', 401);
      }
      if (token.scopes.some(scope => !connection.scopes.includes(scope))) {
        throw new McpOAuthError('invalid_grant', 'scope no longer authorized', 401);
      }
      connections.set(key, {
        ...connection,
        status: 'active',
        lastUsedAtMs: nowMs,
      });
    },
    async listConnections(uid) {
      return [...connections.entries()]
        .filter(([key]) => key.startsWith(`${uid}:`))
        .map(([, connection]) => connection);
    },
    async revokeConnection(target, nowMs) {
      let uid: string;
      let connectionId: string;
      let expectedClientId: string | null = null;
      let matchedToken: AccessTokenRecord | (RefreshTokenRecord & { active: boolean }) | null = null;
      if (target.kind === 'token') {
        const accessToken = accessTokens.get(target.tokenHash);
        const refreshToken = refreshTokens.get(target.tokenHash);
        const candidates = target.tokenTypeHint === 'refresh_token'
          ? [refreshToken, accessToken]
          : [accessToken, refreshToken];
        const token = candidates.find(candidate => (
          candidate
          && candidate.clientId === target.clientId
          && candidate.expiresAtMs > nowMs
        ));
        if (!token) {
          return;
        }
        uid = token.uid;
        connectionId = token.connectionId;
        expectedClientId = target.clientId;
        matchedToken = token;
      } else {
        uid = target.uid;
        connectionId = target.connectionId;
      }
      const key = connectionKey(uid, connectionId);
      const connection = connections.get(key);
      if (!connection || (expectedClientId !== null && connection.clientId !== expectedClientId)) {
        return;
      }
      if (target.kind === 'token') {
        if (connection.revokedAtMs !== null || connection.status === 'revoked') {
          return;
        }
        const tokenGrantId = matchedToken && 'familyId' in matchedToken
          ? matchedToken.familyId
          : matchedToken?.grantId;
        const logicalConnectionId = buildMcpLogicalConnectionId(connection.clientId);
        const requiresGrantId = connectionId === logicalConnectionId
          || connection.supersedesLegacy === true;
        if (
          requiresGrantId
            ? (
              typeof connection.grantId !== 'string'
              || connection.grantId.length === 0
              || connection.grantId !== tokenGrantId
            )
            : (
              connection.grantId !== undefined
              && connection.grantId !== tokenGrantId
            )
        ) {
          return;
        }
        connections.set(key, {
          ...connection,
          status: 'revoked',
          revokedAtMs: nowMs,
        });
        return;
      }

      const logicalConnectionId = buildMcpLogicalConnectionId(connection.clientId);
      const logicalKey = connectionKey(uid, logicalConnectionId);
      const logicalConnection = connections.get(logicalKey);
      if (logicalConnection && logicalConnection.clientId !== connection.clientId) {
        throw new McpOAuthError('invalid_grant', 'connection identity conflict');
      }
      connections.set(key, {
        ...connection,
        status: 'revoked',
        revokedAtMs: connection.revokedAtMs ?? nowMs,
        pendingAuthorizationCodeHash: undefined,
        pendingAuthorizationApprovedAtMs: undefined,
        pendingAuthorizationExpiresAtMs: undefined,
      });
      connections.set(logicalKey, {
        ...(logicalConnection || connection),
        connectionId: logicalConnectionId,
        status: 'revoked',
        revokedAtMs: logicalConnection?.revokedAtMs ?? nowMs,
        supersedesLegacy: true,
        pendingAuthorizationCodeHash: undefined,
        pendingAuthorizationApprovedAtMs: undefined,
        pendingAuthorizationExpiresAtMs: undefined,
      });
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
  it('enforces the complete parent and location scope dependency matrix', () => {
    const states = [false, true];
    for (const activityDetails of states) {
      for (const activityLocation of states) {
        for (const routes of states) {
          for (const routeLocation of states) {
            const scopes = [
              ...(activityDetails ? [MCP_OAUTH_SCOPES.ActivityDetailsRead] : []),
              ...(activityLocation ? [MCP_OAUTH_SCOPES.ActivityLocationRead] : []),
              ...(routes ? [MCP_OAUTH_SCOPES.RoutesRead] : []),
              ...(routeLocation ? [MCP_OAUTH_SCOPES.RouteLocationRead] : []),
            ];
            expect(hasValidMcpScopeDependencies(scopes)).toBe(
              (!activityLocation || activityDetails)
              && (!routeLocation || routes),
            );
          }
        }
      }
    }
  });

  it('accepts each independent read scope', () => {
    expect(normalizeOAuthScopes(
      'metrics:read measurements:read activity-details:read activity-location:read routes:read route-location:read sleep:read',
    )).toEqual([
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.MeasurementsRead,
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.ActivityLocationRead,
      MCP_OAUTH_SCOPES.RoutesRead,
      MCP_OAUTH_SCOPES.RouteLocationRead,
      MCP_OAUTH_SCOPES.SleepRead,
    ]);
    expect(() => normalizeOAuthScopes('activity-details:write')).toThrow(
      expect.objectContaining({ code: 'invalid_scope' }),
    );
    expect(() => normalizeOAuthScopes('activity-location:read')).toThrow(
      expect.objectContaining({ code: 'invalid_scope' }),
    );
    expect(() => normalizeOAuthScopes('route-location:read')).toThrow(
      expect.objectContaining({ code: 'invalid_scope' }),
    );
  });

  it('pins every validated DNS address using the callback shape requested by Node', async () => {
    const pinnedLookup = createPinnedAddressLookup([
      { address: '2001:4860:4860::8888', family: 6 },
      { address: '8.8.8.8', family: 4 },
    ]);
    const lookupWith = (
      options: Parameters<typeof pinnedLookup>[1],
    ): Promise<{
      address: string | LookupAddress[];
      family: number | undefined;
    }> => new Promise((resolve, reject) => {
      pinnedLookup('client.example', options, (error, address, family) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ address, family });
      });
    });

    await expect(lookupWith({ all: true })).resolves.toEqual({
      address: [
        { address: '2001:4860:4860::8888', family: 6 },
        { address: '8.8.8.8', family: 4 },
      ],
      family: undefined,
    });
    await expect(lookupWith({ family: 4 })).resolves.toEqual({
      address: '8.8.8.8',
      family: 4,
    });
    await expect(lookupWith({ all: true, family: 4 })).resolves.toEqual({
      address: [
        { address: '8.8.8.8', family: 4 },
      ],
      family: undefined,
    });
  });

  it('accepts only schema-valid Client ID Metadata array fields', () => {
    expect(validateClientMetadataDocument({
      ...metadata(),
      client_name: '  Example MCP Client  ',
    }, metadata().client_id)).toEqual({
      ...metadata(),
      client_name: 'Example MCP Client',
    });
    expect(() => validateClientMetadataDocument({
      ...metadata(),
      grant_types: 'authorization_code',
    }, metadata().client_id)).toThrow(expect.objectContaining({
      code: 'invalid_client',
    }));
    expect(() => validateClientMetadataDocument({
      ...metadata(),
      redirect_uris: ['https://client.example/oauth/callback', 42],
    }, metadata().client_id)).toThrow(expect.objectContaining({
      code: 'invalid_client',
    }));
    expect(() => validateClientMetadataDocument({
      ...metadata(),
      redirect_uris: [' https://client.example/oauth/callback '],
    }, metadata().client_id)).toThrow(expect.objectContaining({
      code: 'invalid_client',
    }));
    expect(() => validateClientMetadataDocument({
      ...metadata(),
      token_endpoint_auth_method: '',
    }, metadata().client_id)).toThrow(expect.objectContaining({
      code: 'invalid_client',
    }));
  });

  it('shares one request-rate bucket across access tokens for a connection', () => {
    const windowStartMs = 60_000;

    expect(buildMcpRateLimitBucketId({
      uid: 'user-1',
      connectionId: 'connection-1',
    }, windowStartMs)).toBe(buildMcpRateLimitBucketId({
      uid: 'user-1',
      connectionId: 'connection-1',
    }, windowStartMs));
    expect(buildMcpRateLimitBucketId({
      uid: 'user-1',
      connectionId: 'connection-1',
    }, windowStartMs)).not.toBe(buildMcpRateLimitBucketId({
      uid: 'user-1',
      connectionId: 'connection-2',
    }, windowStartMs));
  });

  it('derives a stable logical connection only from the exact verified client identity', () => {
    const clientId = metadata().client_id;
    const logicalConnectionId = buildMcpLogicalConnectionId(clientId);

    expect(logicalConnectionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(buildMcpLogicalConnectionId(clientId)).toBe(logicalConnectionId);
    expect(buildMcpLogicalConnectionId('https://client.example/MCP.json')).not.toBe(
      logicalConnectionId,
    );
    expect(buildMcpLogicalConnectionId(`${clientId}/`)).not.toBe(logicalConnectionId);
  });

  it('rejects malformed document IDs before accessing OAuth state', async () => {
    const store = createMemoryStore();
    const getAuthorizationRequest = vi.spyOn(store, 'getAuthorizationRequest');
    const denyAuthorization = vi.spyOn(store, 'denyAuthorization');
    const revokeConnection = vi.spyOn(store, 'revokeConnection');
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn(),
      now: () => 1000,
      randomToken: () => 'unused',
    });

    await expect(service.getConsentDetails('request/child')).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(service.decideAuthorization({
      uid: 'user-1',
      requestId: 'request/child',
      approved: false,
    })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(() => service.revokeConnection(
      'user-1',
      'connection/child',
    )).toThrow(expect.objectContaining({
      code: 'invalid_request',
    }));

    expect(getAuthorizationRequest).not.toHaveBeenCalled();
    expect(denyAuthorization).not.toHaveBeenCalled();
    expect(revokeConnection).not.toHaveBeenCalled();
  });

  it('rate-limits authorization starts before fetching client metadata or saving state', async () => {
    const store = createMemoryStore();
    const consumeAuthorizationStartRateLimit = vi
      .spyOn(store, 'consumeAuthorizationStartRateLimit')
      .mockRejectedValueOnce(new McpOAuthError(
        'temporarily_unavailable',
        'authorization rate limit exceeded',
        429,
      ));
    const saveAuthorizationRequest = vi.spyOn(store, 'saveAuthorizationRequest');
    const fetchClientMetadata = vi.fn().mockResolvedValue(metadata());
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata,
      now: () => 61_000,
      randomToken: () => 'request-id',
    });

    await expect(service.startAuthorization(
      authorizationParams('v'.repeat(43)),
      'https://quantified-self.io',
      { requesterKey: '203.0.113.10' },
    )).rejects.toMatchObject({
      code: 'temporarily_unavailable',
      statusCode: 429,
    });

    expect(consumeAuthorizationStartRateLimit).toHaveBeenCalledWith({
      clientId: metadata().client_id,
      requesterKey: '203.0.113.10',
      nowMs: 61_000,
    });
    expect(fetchClientMetadata).not.toHaveBeenCalled();
    expect(saveAuthorizationRequest).not.toHaveBeenCalled();
  });

  it('requires PKCE, the exact MCP resource, and an exact registered redirect', async () => {
    const store = createMemoryStore();
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn().mockResolvedValue(metadata()),
      now: () => 1000,
      randomToken: () => 'request-id',
    });
    const verifier = 'v'.repeat(43);

    const responseTypeError = await service.startAuthorization({
      ...authorizationParams(verifier),
      response_type: 'token',
    }, 'https://quantified-self.io').then(
      () => null,
      error => error as { code: string; redirectUri: string },
    );
    expect(responseTypeError).toMatchObject({
      code: 'unsupported_response_type',
      redirectUri: expect.stringContaining('error=unsupported_response_type'),
    });
    expect(new URL(responseTypeError!.redirectUri).searchParams.get('state'))
      .toBe('client-state');

    await expect(service.startAuthorization({
      ...authorizationParams(verifier),
      code_challenge_method: 'plain',
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_request' });

    await expect(service.startAuthorization({
      ...authorizationParams(verifier),
      code_challenge: 'a'.repeat(44),
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_request' });

    await expect(service.startAuthorization({
      ...authorizationParams(verifier),
      resource: 'https://other.example/mcp',
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_request' });

    const invalidRedirectError = await service.startAuthorization({
      ...authorizationParams(verifier),
      redirect_uri: 'https://evil.example/callback',
    }, 'https://quantified-self.io').then(() => null, error => error);
    expect(invalidRedirectError).toMatchObject({ code: 'invalid_client' });
    expect(invalidRedirectError).not.toBeInstanceOf(McpOAuthAuthorizationRedirectError);

    await expect(service.startAuthorization({
      ...authorizationParams(verifier),
      redirect_uri: ` ${metadata().redirect_uris[0]} `,
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_client' });

    await expect(service.startAuthorization({
      ...authorizationParams(verifier),
      scope: ['metrics:read', 'sleep:read'],
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_request' });

    await expect(service.startAuthorization({
      ...authorizationParams(verifier),
      response_type: '',
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('preserves optional OAuth state exactly in authorization responses', async () => {
    const verifier = 'v'.repeat(43);
    const exactState = ' state with leading and trailing spaces ';
    const withStateStore = createMemoryStore();
    const withStateService = createMcpOAuthService({
      store: withStateStore,
      fetchClientMetadata: vi.fn().mockResolvedValue(metadata()),
      now: () => 1000,
      randomToken: () => 'request-with-state',
    });
    const withState = await withStateService.startAuthorization({
      ...authorizationParams(verifier),
      state: exactState,
    }, 'https://quantified-self.io');

    expect(withStateStore.requests.get(withState.requestId)?.state).toBe(exactState);
    const approvedWithState = await withStateService.decideAuthorization({
      uid: 'user-1',
      requestId: withState.requestId,
      approved: true,
    });
    const approvalParams = new URL(approvedWithState.redirectUri).searchParams;
    expect(approvalParams.get('state')).toBe(exactState);
    expect(approvalParams.get('code')).toEqual(expect.any(String));

    const withoutStateStore = createMemoryStore();
    let requestCounter = 0;
    const withoutStateService = createMcpOAuthService({
      store: withoutStateStore,
      fetchClientMetadata: vi.fn().mockResolvedValue(metadata()),
      now: () => 1000,
      randomToken: () => `request-without-state-${++requestCounter}`,
    });
    const withoutState = await withoutStateService.startAuthorization({
      ...authorizationParams(verifier),
      state: undefined,
    }, 'https://quantified-self.io');

    expect(withoutStateStore.requests.get(withoutState.requestId)?.state).toBeNull();
    const deniedWithoutState = await withoutStateService.decideAuthorization({
      uid: 'user-1',
      requestId: withoutState.requestId,
      approved: false,
    });
    expect(new URL(deniedWithoutState.redirectUri).searchParams.has('state')).toBe(false);

    const withValuelessState = await withoutStateService.startAuthorization({
      ...authorizationParams(verifier),
      state: '',
    }, 'https://quantified-self.io');
    expect(withoutStateStore.requests.get(withValuelessState.requestId)?.state).toBeNull();
    const deniedWithValuelessState = await withoutStateService.decideAuthorization({
      uid: 'user-1',
      requestId: withValuelessState.requestId,
      approved: false,
    });
    expect(new URL(deniedWithValuelessState.redirectUri).searchParams.has('state')).toBe(false);

    await expect(withoutStateService.startAuthorization({
      ...authorizationParams(verifier),
      state: 'line one\nline two',
    }, 'https://quantified-self.io')).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(withoutStateService.startAuthorization({
      ...authorizationParams(verifier),
      state: 'unicode-\u2603',
    }, 'https://quantified-self.io')).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('issues one-time opaque tokens, rotates refresh tokens, and enforces audience binding', async () => {
    const store = createMemoryStore();
    let nowMs = 1000;
    const randomValues = [
      'request-id',
      'authorization-code',
      'access-token-1',
      'refresh-token-1',
      'family-id',
      'replay-access-token',
      'replay-refresh-token',
      'replay-family-id',
      'access-token-2',
      'refresh-token-2',
      'reused-access-token',
      'reused-refresh-token',
      'replay-detected-access-token',
      'replay-detected-refresh-token',
      'final-replay-access-token',
      'final-replay-refresh-token',
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
    const logicalConnectionId = buildMcpLogicalConnectionId(metadata().client_id);
    expect(store.connections.get(`user-1:${logicalConnectionId}`)).toEqual(expect.objectContaining({
      status: 'pending',
      lastUsedAtMs: null,
    }));
    await expect(service.listConnections('user-1')).resolves.toEqual([]);

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
    expect(store.connections.get(`user-1:${logicalConnectionId}`)).toEqual(expect.objectContaining({
      status: 'active',
      lastUsedAtMs: 1000,
    }));
    await expect(service.listConnections('user-1')).resolves.toHaveLength(1);

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
      tokens.access_token,
      'https://quantified-self.io/mcp',
    )).rejects.toMatchObject({
      code: 'invalid_grant',
      statusCode: 401,
    });

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

    const retainedScope = await service.exchangeRefreshToken({
      grant_type: 'refresh_token',
      refresh_token: rotated.refresh_token,
      client_id: metadata().client_id,
      scope: '',
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io');
    expect(retainedScope).toEqual(expect.objectContaining({
      access_token: 'reused-access-token',
      refresh_token: 'reused-refresh-token',
      scope: 'metrics:read',
    }));
    expect(store.refreshTokens.get(hashOpaqueValue(rotated.refresh_token))?.active).toBe(false);
    expect(store.refreshTokens.get(hashOpaqueValue(retainedScope.refresh_token))?.active).toBe(true);

    await expect(service.exchangeRefreshToken({
      grant_type: 'refresh_token',
      refresh_token: retainedScope.refresh_token,
      client_id: metadata().client_id,
      scope: ['metrics:read'],
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io')).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(store.refreshTokens.get(hashOpaqueValue(retainedScope.refresh_token))?.active).toBe(true);

    await expect(service.exchangeRefreshToken({
      grant_type: 'refresh_token',
      refresh_token: retainedScope.refresh_token,
      client_id: metadata().client_id,
      scope: 'metrics:read sleep:read',
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io')).rejects.toMatchObject({
      code: 'invalid_scope',
    });

    await expect(service.exchangeRefreshToken({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: metadata().client_id,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io')).rejects.toMatchObject({
      code: 'invalid_grant',
    });
    await expect(service.authenticateBearer(
      retainedScope.access_token,
      'https://quantified-self.io/mcp',
    )).rejects.toMatchObject({ statusCode: 401 });
  });

  it('reuses one logical connection and cuts over only when reauthorization succeeds', async () => {
    const store = createMemoryStore();
    let nowMs = 1_000;
    const randomValues = [
      'request-1',
      'code-1',
      'access-1',
      'refresh-1',
      'family-1',
      'request-2',
      'code-2',
      'access-2',
      'refresh-2',
      'family-2',
      'stale-refresh-access',
      'stale-refresh-token',
    ];
    const fetchClientMetadata = vi.fn()
      .mockResolvedValueOnce(metadata())
      .mockResolvedValueOnce({
        ...metadata(),
        client_name: 'Renamed MCP Client',
      });
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata,
      now: () => nowMs,
      randomToken: () => randomValues.shift()!,
    });
    const verifier = 'correct-verifier-value-with-at-least-43-characters';
    const logicalConnectionId = buildMcpLogicalConnectionId(metadata().client_id);

    const firstStart = await service.startAuthorization(
      authorizationParams(verifier),
      'https://quantified-self.io',
    );
    const firstApproval = await service.decideAuthorization({
      uid: 'user-1',
      requestId: firstStart.requestId,
      approved: true,
    });
    const firstCode = new URL(firstApproval.redirectUri).searchParams.get('code')!;
    const firstTokens = await service.exchangeAuthorizationCode({
      grant_type: 'authorization_code',
      code: firstCode,
      client_id: metadata().client_id,
      redirect_uri: metadata().redirect_uris[0],
      code_verifier: verifier,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io');

    nowMs = 2_000;
    const secondStart = await service.startAuthorization(
      authorizationParams(verifier),
      'https://quantified-self.io',
    );
    const secondApproval = await service.decideAuthorization({
      uid: 'user-1',
      requestId: secondStart.requestId,
      approved: true,
      grantedScopes: [MCP_OAUTH_SCOPES.MetricsRead],
    });
    const secondCode = new URL(secondApproval.redirectUri).searchParams.get('code')!;
    const pendingCutover = store.connections.get(`user-1:${logicalConnectionId}`);

    expect(pendingCutover).toEqual(expect.objectContaining({
      clientName: metadata().client_name,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead, MCP_OAUTH_SCOPES.SleepRead],
      grantId: 'family-1',
      status: 'active',
      pendingAuthorizationCodeHash: hashOpaqueValue(secondCode),
    }));
    await expect(service.authenticateBearer(
      firstTokens.access_token,
      'https://quantified-self.io/mcp',
    )).resolves.toMatchObject({ connectionId: logicalConnectionId });
    await expect(service.listConnections('user-1')).resolves.toHaveLength(1);

    // Revoking the old live grant must not cancel an independently approved
    // replacement that has not completed its code exchange yet.
    await service.revokeToken({
      token: firstTokens.access_token,
      token_type_hint: 'access_token',
      client_id: metadata().client_id,
    });
    expect(store.connections.get(`user-1:${logicalConnectionId}`)).toEqual(
      expect.objectContaining({
        status: 'revoked',
        pendingAuthorizationCodeHash: hashOpaqueValue(secondCode),
      }),
    );

    const secondTokens = await service.exchangeAuthorizationCode({
      grant_type: 'authorization_code',
      code: secondCode,
      client_id: metadata().client_id,
      redirect_uri: metadata().redirect_uris[0],
      code_verifier: verifier,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io');
    expect(secondTokens).toEqual(expect.objectContaining({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      scope: 'metrics:read',
    }));
    expect(store.connections.size).toBe(1);
    expect(store.connections.get(`user-1:${logicalConnectionId}`)).toEqual(
      expect.objectContaining({
        clientName: 'Renamed MCP Client',
        scopes: [MCP_OAUTH_SCOPES.MetricsRead],
        grantId: 'family-2',
        status: 'active',
        revokedAtMs: null,
        supersedesLegacy: true,
      }),
    );

    await expect(service.authenticateBearer(
      firstTokens.access_token,
      'https://quantified-self.io/mcp',
    )).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.exchangeRefreshToken({
      grant_type: 'refresh_token',
      refresh_token: firstTokens.refresh_token,
      client_id: metadata().client_id,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_grant' });

    // A late RFC 7009 request for the old grant is a successful no-op and
    // cannot revoke the replacement.
    await service.revokeToken({
      token: firstTokens.access_token,
      token_type_hint: 'access_token',
      client_id: metadata().client_id,
    });
    await expect(service.authenticateBearer(
      secondTokens.access_token,
      'https://quantified-self.io/mcp',
    )).resolves.toMatchObject({
      connectionId: logicalConnectionId,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
    });
    await expect(service.listConnections('user-1')).resolves.toHaveLength(1);
  });

  it('lets only the latest approved code activate a logical connection', async () => {
    const store = createMemoryStore();
    const randomValues = [
      'request-1',
      'code-1',
      'request-2',
      'code-2',
      'rejected-access',
      'rejected-refresh',
      'rejected-family',
      'accepted-access',
      'accepted-refresh',
      'accepted-family',
    ];
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn().mockResolvedValue(metadata()),
      now: () => 1_000,
      randomToken: () => randomValues.shift()!,
    });
    const verifier = 'correct-verifier-value-with-at-least-43-characters';

    const firstStart = await service.startAuthorization(
      authorizationParams(verifier),
      'https://quantified-self.io',
    );
    const firstApproval = await service.decideAuthorization({
      uid: 'user-1',
      requestId: firstStart.requestId,
      approved: true,
      grantedScopes: [MCP_OAUTH_SCOPES.MetricsRead],
    });
    const secondStart = await service.startAuthorization(
      authorizationParams(verifier),
      'https://quantified-self.io',
    );
    const secondApproval = await service.decideAuthorization({
      uid: 'user-1',
      requestId: secondStart.requestId,
      approved: true,
      grantedScopes: [MCP_OAUTH_SCOPES.MetricsRead, MCP_OAUTH_SCOPES.SleepRead],
    });
    const firstCode = new URL(firstApproval.redirectUri).searchParams.get('code')!;
    const secondCode = new URL(secondApproval.redirectUri).searchParams.get('code')!;

    await expect(service.exchangeAuthorizationCode({
      grant_type: 'authorization_code',
      code: firstCode,
      client_id: metadata().client_id,
      redirect_uri: metadata().redirect_uris[0],
      code_verifier: verifier,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(service.exchangeAuthorizationCode({
      grant_type: 'authorization_code',
      code: secondCode,
      client_id: metadata().client_id,
      redirect_uri: metadata().redirect_uris[0],
      code_verifier: verifier,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io')).resolves.toMatchObject({
      access_token: 'accepted-access',
      scope: 'metrics:read sleep:read',
    });
    await expect(service.listConnections('user-1')).resolves.toHaveLength(1);
  });

  it('does not let refresh replay cancel a pending or replacement grant', async () => {
    const store = createMemoryStore();
    const randomValues = [
      'request-1',
      'code-1',
      'access-1',
      'refresh-1',
      'family-1',
      'rotated-access',
      'rotated-refresh',
      'request-2',
      'code-2',
      'replay-access',
      'replay-refresh',
      'access-2',
      'refresh-2',
      'family-2',
      'late-replay-access',
      'late-replay-refresh',
    ];
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn().mockResolvedValue(metadata()),
      now: () => 1_000,
      randomToken: () => randomValues.shift()!,
    });
    const verifier = 'correct-verifier-value-with-at-least-43-characters';
    const logicalConnectionId = buildMcpLogicalConnectionId(metadata().client_id);

    const firstStart = await service.startAuthorization(
      authorizationParams(verifier),
      'https://quantified-self.io',
    );
    const firstApproval = await service.decideAuthorization({
      uid: 'user-1',
      requestId: firstStart.requestId,
      approved: true,
    });
    const firstTokens = await service.exchangeAuthorizationCode({
      grant_type: 'authorization_code',
      code: new URL(firstApproval.redirectUri).searchParams.get('code')!,
      client_id: metadata().client_id,
      redirect_uri: metadata().redirect_uris[0],
      code_verifier: verifier,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io');
    await service.exchangeRefreshToken({
      grant_type: 'refresh_token',
      refresh_token: firstTokens.refresh_token,
      client_id: metadata().client_id,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io');

    const secondStart = await service.startAuthorization(
      authorizationParams(verifier),
      'https://quantified-self.io',
    );
    const secondApproval = await service.decideAuthorization({
      uid: 'user-1',
      requestId: secondStart.requestId,
      approved: true,
    });
    const secondCode = new URL(secondApproval.redirectUri).searchParams.get('code')!;

    await expect(service.exchangeRefreshToken({
      grant_type: 'refresh_token',
      refresh_token: firstTokens.refresh_token,
      client_id: metadata().client_id,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(store.connections.get(`user-1:${logicalConnectionId}`)).toEqual(
      expect.objectContaining({
        status: 'revoked',
        pendingAuthorizationCodeHash: hashOpaqueValue(secondCode),
      }),
    );

    const replacement = await service.exchangeAuthorizationCode({
      grant_type: 'authorization_code',
      code: secondCode,
      client_id: metadata().client_id,
      redirect_uri: metadata().redirect_uris[0],
      code_verifier: verifier,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io');
    await expect(service.exchangeRefreshToken({
      grant_type: 'refresh_token',
      refresh_token: firstTokens.refresh_token,
      client_id: metadata().client_id,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(service.authenticateBearer(
      replacement.access_token,
      'https://quantified-self.io/mcp',
    )).resolves.toMatchObject({
      connectionId: logicalConnectionId,
    });
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
    expect(isPrivateAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateAddress('fc00::1')).toBe(true);
    expect(isPrivateAddress('fec0::1')).toBe(true);
    expect(isPrivateAddress('2001:db8::1')).toBe(true);
    expect(isPrivateAddress('2002:7f00:1::')).toBe(true);
    expect(isPrivateAddress('not-an-ip')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
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
      status: 'active',
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

  it('revokes the complete token family through RFC 7009 without affecting another connection', async () => {
    const store = createMemoryStore();
    const consumeRevocationRateLimit = vi.spyOn(store, 'consumeRevocationRateLimit');
    const revokeConnection = vi.spyOn(store, 'revokeConnection');
    const fetchClientMetadata = vi.fn();
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata,
      now: () => 5_000,
      randomToken: () => 'unused-next-token',
    });
    const clientId = metadata().client_id;
    const baseConnection: McpConnection = {
      connectionId: 'connection-1',
      clientId,
      clientName: metadata().client_name,
      redirectHost: 'client.example',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      createdAtMs: 1,
      lastUsedAtMs: 1,
      revokedAtMs: null,
      status: 'active',
    };
    store.connections.set('user-1:connection-1', baseConnection);
    store.connections.set('user-1:connection-2', {
      ...baseConnection,
      connectionId: 'connection-2',
    });
    store.accessTokens.set(hashOpaqueValue('access-token-1'), {
      uid: 'user-1',
      connectionId: 'connection-1',
      clientId,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 1,
      expiresAtMs: 10_000,
    });
    store.refreshTokens.set(hashOpaqueValue('refresh-token-1'), {
      uid: 'user-1',
      connectionId: 'connection-1',
      clientId,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      familyId: 'family-1',
      createdAtMs: 1,
      expiresAtMs: 10_000,
      active: true,
    });
    store.accessTokens.set(hashOpaqueValue('access-token-2'), {
      uid: 'user-1',
      connectionId: 'connection-2',
      clientId,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 1,
      expiresAtMs: 10_000,
    });

    await expect(service.authenticateBearer(
      'access-token-1',
      'https://quantified-self.io/mcp',
    )).resolves.toMatchObject({ connectionId: 'connection-1' });

    await service.revokeToken({
      token: 'access-token-1',
      token_type_hint: 'refresh_token',
      client_id: clientId,
    }, {
      requesterKey: '203.0.113.10',
    });

    expect(consumeRevocationRateLimit).toHaveBeenCalledWith({
      clientId,
      requesterKey: '203.0.113.10',
      nowMs: 5_000,
    });
    expect(revokeConnection).toHaveBeenCalledWith({
      kind: 'token',
      tokenHash: hashOpaqueValue('access-token-1'),
      tokenTypeHint: 'refresh_token',
      clientId,
    }, 5_000);
    expect(JSON.stringify(revokeConnection.mock.calls)).not.toContain('access-token-1');
    expect(fetchClientMetadata).not.toHaveBeenCalled();
    expect(store.connections.get('user-1:connection-1')).toEqual(
      expect.objectContaining({
        status: 'revoked',
        revokedAtMs: 5_000,
      }),
    );
    expect(store.accessTokens.has(hashOpaqueValue('access-token-1'))).toBe(true);
    expect(store.refreshTokens.has(hashOpaqueValue('refresh-token-1'))).toBe(true);
    await expect(service.authenticateBearer(
      'access-token-1',
      'https://quantified-self.io/mcp',
    )).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.exchangeRefreshToken({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-token-1',
      client_id: clientId,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io')).rejects.toMatchObject({
      code: 'invalid_grant',
    });
    await expect(service.authenticateBearer(
      'access-token-2',
      'https://quantified-self.io/mcp',
    )).resolves.toMatchObject({ connectionId: 'connection-2' });
  });

  it('keeps RFC 7009 responses private, idempotent, and bound to the public client', async () => {
    const store = createMemoryStore();
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn(),
      now: () => 5_000,
      randomToken: () => 'unused',
    });
    const clientId = metadata().client_id;
    const otherClientId = 'https://other-client.example/mcp.json';
    store.connections.set('user-1:connection-1', {
      connectionId: 'connection-1',
      clientId,
      clientName: metadata().client_name,
      redirectHost: 'client.example',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      createdAtMs: 1,
      lastUsedAtMs: 1,
      revokedAtMs: null,
      status: 'active',
    });
    store.accessTokens.set(hashOpaqueValue('access-token'), {
      uid: 'user-1',
      connectionId: 'connection-1',
      clientId,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 1,
      expiresAtMs: 10_000,
    });
    store.accessTokens.set(hashOpaqueValue('expired-token'), {
      uid: 'user-1',
      connectionId: 'connection-1',
      clientId,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 1,
      expiresAtMs: 4_000,
    });

    await expect(service.revokeToken({
      token: 'unknown-token',
      client_id: clientId,
    })).resolves.toBeUndefined();
    await expect(service.revokeToken({
      token: 'expired-token',
      client_id: clientId,
    })).resolves.toBeUndefined();
    await expect(service.revokeToken({
      token: 'access-token',
      client_id: otherClientId,
    })).resolves.toBeUndefined();
    expect(store.connections.get('user-1:connection-1')?.status).toBe('active');

    await expect(service.revokeToken({
      token: 'access-token',
      token_type_hint: 'an-unregistered-hint',
      client_id: clientId,
    })).resolves.toBeUndefined();
    const terminalState = store.connections.get('user-1:connection-1');
    await expect(service.revokeToken({
      token: 'access-token',
      token_type_hint: 'access_token',
      client_id: clientId,
    })).resolves.toBeUndefined();
    expect(store.connections.get('user-1:connection-1')).toEqual(terminalState);
  });

  it('revokes descendants when a submitted refresh token was concurrently rotated', async () => {
    const store = createMemoryStore();
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn(),
      now: () => 5_000,
      randomToken: () => 'unused',
    });
    const clientId = metadata().client_id;
    store.connections.set('user-1:connection-1', {
      connectionId: 'connection-1',
      clientId,
      clientName: metadata().client_name,
      redirectHost: 'client.example',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      createdAtMs: 1,
      lastUsedAtMs: 1,
      revokedAtMs: null,
      status: 'active',
    });
    store.refreshTokens.set(hashOpaqueValue('rotated-refresh-token'), {
      uid: 'user-1',
      connectionId: 'connection-1',
      clientId,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      familyId: 'family-1',
      createdAtMs: 1,
      expiresAtMs: 10_000,
      active: false,
    });
    store.accessTokens.set(hashOpaqueValue('descendant-access-token'), {
      uid: 'user-1',
      connectionId: 'connection-1',
      clientId,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 2,
      expiresAtMs: 10_000,
    });

    await expect(service.authenticateBearer(
      'descendant-access-token',
      'https://quantified-self.io/mcp',
    )).resolves.toMatchObject({ connectionId: 'connection-1' });
    await service.revokeToken({
      token: 'rotated-refresh-token',
      token_type_hint: 'refresh_token',
      client_id: clientId,
    });
    await expect(service.authenticateBearer(
      'descendant-access-token',
      'https://quantified-self.io/mcp',
    )).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rate-limits token revocation before hashed-token state lookup', async () => {
    const store = createMemoryStore();
    vi.spyOn(store, 'consumeRevocationRateLimit').mockRejectedValueOnce(
      new McpOAuthError(
        'temporarily_unavailable',
        'revocation rate limit exceeded',
        429,
      ),
    );
    const revokeConnection = vi.spyOn(store, 'revokeConnection');
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn(),
      now: () => 5_000,
      randomToken: () => 'unused',
    });

    await expect(service.revokeToken({
      token: 'raw-secret-token',
      client_id: metadata().client_id,
    }, {
      requesterKey: '203.0.113.10',
    })).rejects.toMatchObject({
      code: 'temporarily_unavailable',
      statusCode: 429,
    });
    expect(revokeConnection).not.toHaveBeenCalled();
  });

  it('requires an HTTPS public CIMD client identity before revocation state access', async () => {
    const store = createMemoryStore();
    const consumeRevocationRateLimit = vi.spyOn(store, 'consumeRevocationRateLimit');
    const revokeConnection = vi.spyOn(store, 'revokeConnection');
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn(),
      now: () => 5_000,
      randomToken: () => 'unused',
    });

    for (const clientId of [
      '',
      'client-id',
      'http://client.example/mcp.json',
      'https://client.example',
      'https://127.0.0.1/mcp.json',
    ]) {
      await expect(service.revokeToken({
        token: 'opaque-token',
        client_id: clientId,
      })).rejects.toBeInstanceOf(McpOAuthError);
    }

    expect(consumeRevocationRateLimit).not.toHaveBeenCalled();
    expect(revokeConnection).not.toHaveBeenCalled();
  });

  it('uses the same terminal state for dashboard and token revocation', async () => {
    const store = createMemoryStore();
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn(),
      now: () => 5_000,
      randomToken: () => 'unused',
    });
    const connection: McpConnection = {
      connectionId: 'dashboard-connection',
      clientId: metadata().client_id,
      clientName: metadata().client_name,
      redirectHost: 'client.example',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      createdAtMs: 1,
      lastUsedAtMs: 1,
      revokedAtMs: null,
      status: 'active',
    };
    store.connections.set('user-1:dashboard-connection', connection);
    store.connections.set('user-1:client-connection', {
      ...connection,
      connectionId: 'client-connection',
    });
    store.refreshTokens.set(hashOpaqueValue('refresh-token'), {
      uid: 'user-1',
      connectionId: 'client-connection',
      clientId: metadata().client_id,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      familyId: 'family-1',
      createdAtMs: 1,
      expiresAtMs: 10_000,
      active: true,
    });

    await service.revokeConnection('user-1', 'dashboard-connection');
    await service.revokeToken({
      token: 'refresh-token',
      token_type_hint: 'refresh_token',
      client_id: metadata().client_id,
    });

    expect(store.connections.get('user-1:dashboard-connection')).toEqual(
      expect.objectContaining({
        status: 'revoked',
        revokedAtMs: 5_000,
      }),
    );
    expect(store.connections.get('user-1:client-connection')).toEqual(
      expect.objectContaining({
        status: 'revoked',
        revokedAtMs: 5_000,
      }),
    );
  });

  it('does not exchange an authorization code after its connection is revoked', async () => {
    const store = createMemoryStore();
    const randomValues = [
      'request-id',
      'authorization-code',
      'access-token',
      'refresh-token',
      'family-id',
    ];
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn().mockResolvedValue(metadata()),
      now: () => 5000,
      randomToken: () => randomValues.shift()!,
    });
    const verifier = 'correct-verifier-value-with-at-least-43-characters';
    const started = await service.startAuthorization(
      authorizationParams(verifier),
      'https://quantified-self.io',
    );
    const approved = await service.decideAuthorization({
      uid: 'user-1',
      requestId: started.requestId,
      approved: true,
    });
    const code = new URL(approved.redirectUri).searchParams.get('code')!;
    const logicalConnectionId = buildMcpLogicalConnectionId(metadata().client_id);
    await service.revokeConnection('user-1', logicalConnectionId);

    await expect(service.exchangeAuthorizationCode({
      code,
      client_id: metadata().client_id,
      redirect_uri: metadata().redirect_uris[0],
      code_verifier: verifier,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io')).rejects.toMatchObject({
      code: 'invalid_grant',
    });
    expect(store.accessTokens.size).toBe(0);
    expect(store.refreshTokens.size).toBe(0);
  });

  it('activates an in-flight legacy authorization created before lifecycle statuses', async () => {
    const store = createMemoryStore();
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn(),
      now: () => 5000,
      randomToken: vi.fn()
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token')
        .mockReturnValueOnce('family-id'),
    });
    const verifier = 'correct-verifier-value-with-at-least-43-characters';
    const code = 'legacy-authorization-code';
    store.codes.set(hashOpaqueValue(code), {
      uid: 'user-1',
      connectionId: 'legacy-connection',
      clientId: metadata().client_id,
      redirectUri: metadata().redirect_uris[0],
      codeChallenge: createPkceChallenge(verifier),
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 4000,
      expiresAtMs: 6000,
    });
    store.connections.set('user-1:legacy-connection', {
      connectionId: 'legacy-connection',
      clientId: metadata().client_id,
      clientName: metadata().client_name,
      redirectHost: 'client.example',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      createdAtMs: 4000,
      lastUsedAtMs: null,
      revokedAtMs: null,
    });

    await expect(service.exchangeAuthorizationCode({
      grant_type: 'authorization_code',
      code,
      client_id: metadata().client_id,
      redirect_uri: metadata().redirect_uris[0],
      code_verifier: verifier,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io')).resolves.toEqual(expect.objectContaining({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    }));
    expect(store.connections.get('user-1:legacy-connection')).toEqual(
      expect.objectContaining({
        status: 'active',
        lastUsedAtMs: 5000,
      }),
    );
  });

  it('keeps a legacy grant usable during pending migration and suppresses it after activation', async () => {
    const store = createMemoryStore();
    const randomValues = [
      'legacy-rotated-access',
      'legacy-rotated-refresh',
      'rejected-access',
      'rejected-refresh',
    ];
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn(),
      now: () => 5_000,
      randomToken: () => randomValues.shift()!,
    });
    const clientId = metadata().client_id;
    const logicalConnectionId = buildMcpLogicalConnectionId(clientId);
    const legacyConnection: McpConnection = {
      connectionId: 'legacy-connection',
      clientId,
      clientName: metadata().client_name,
      redirectHost: 'client.example',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      createdAtMs: 1,
      lastUsedAtMs: 1,
      revokedAtMs: null,
      status: 'active',
    };
    store.connections.set('user-1:legacy-connection', legacyConnection);
    store.connections.set(`user-1:${logicalConnectionId}`, {
      ...legacyConnection,
      connectionId: logicalConnectionId,
      lastUsedAtMs: null,
      status: 'pending',
      pendingAuthorizationCodeHash: 'pending-code',
      pendingAuthorizationExpiresAtMs: 10_000,
    });
    store.accessTokens.set(hashOpaqueValue('legacy-access'), {
      uid: 'user-1',
      connectionId: 'legacy-connection',
      clientId,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 1,
      expiresAtMs: 10_000,
    });
    store.refreshTokens.set(hashOpaqueValue('legacy-refresh'), {
      uid: 'user-1',
      connectionId: 'legacy-connection',
      clientId,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      familyId: 'legacy-family',
      createdAtMs: 1,
      expiresAtMs: 10_000,
      active: true,
    });

    await expect(service.authenticateBearer(
      'legacy-access',
      'https://quantified-self.io/mcp',
    )).resolves.toMatchObject({ connectionId: 'legacy-connection' });
    const rotatedLegacy = await service.exchangeRefreshToken({
      grant_type: 'refresh_token',
      refresh_token: 'legacy-refresh',
      client_id: clientId,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io');
    await expect(service.listConnections('user-1')).resolves.toEqual([
      expect.objectContaining({ connectionId: 'legacy-connection' }),
    ]);

    store.connections.set(`user-1:${logicalConnectionId}`, {
      ...legacyConnection,
      connectionId: logicalConnectionId,
      grantId: 'canonical-family',
      supersedesLegacy: true,
      status: 'active',
      lastUsedAtMs: 5_000,
    });
    store.accessTokens.set(hashOpaqueValue('canonical-access'), {
      uid: 'user-1',
      connectionId: logicalConnectionId,
      clientId,
      grantId: 'canonical-family',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 5_000,
      expiresAtMs: 10_000,
    });

    await expect(service.authenticateBearer(
      'legacy-access',
      'https://quantified-self.io/mcp',
    )).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.exchangeRefreshToken({
      grant_type: 'refresh_token',
      refresh_token: rotatedLegacy.refresh_token,
      client_id: clientId,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(service.authenticateBearer(
      'canonical-access',
      'https://quantified-self.io/mcp',
    )).resolves.toMatchObject({ connectionId: logicalConnectionId });
    await expect(service.listConnections('user-1')).resolves.toEqual([
      expect.objectContaining({ connectionId: logicalConnectionId }),
    ]);
  });

  it('fails closed when a canonical connection is missing its grant generation', async () => {
    const store = createMemoryStore();
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn(),
      now: () => 5_000,
      randomToken: vi.fn()
        .mockReturnValueOnce('unused-access')
        .mockReturnValueOnce('unused-refresh'),
    });
    const clientId = metadata().client_id;
    const logicalConnectionId = buildMcpLogicalConnectionId(clientId);
    store.connections.set(`user-1:${logicalConnectionId}`, {
      connectionId: logicalConnectionId,
      clientId,
      clientName: metadata().client_name,
      redirectHost: 'client.example',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      createdAtMs: 1,
      lastUsedAtMs: 1,
      revokedAtMs: null,
      status: 'active',
      supersedesLegacy: true,
    });
    store.accessTokens.set(hashOpaqueValue('canonical-access'), {
      uid: 'user-1',
      connectionId: logicalConnectionId,
      clientId,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 1,
      expiresAtMs: 10_000,
    });
    store.refreshTokens.set(hashOpaqueValue('canonical-refresh'), {
      uid: 'user-1',
      connectionId: logicalConnectionId,
      clientId,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      familyId: 'family-1',
      createdAtMs: 1,
      expiresAtMs: 10_000,
      active: true,
    });

    await expect(service.authenticateBearer(
      'canonical-access',
      'https://quantified-self.io/mcp',
    )).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.exchangeRefreshToken({
      grant_type: 'refresh_token',
      refresh_token: 'canonical-refresh',
      client_id: clientId,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_grant' });
    await service.revokeToken({
      token: 'canonical-access',
      token_type_hint: 'access_token',
      client_id: clientId,
    });
    expect(store.connections.get(`user-1:${logicalConnectionId}`)).toEqual(
      expect.objectContaining({
        status: 'active',
        revokedAtMs: null,
      }),
    );
  });

  it('rejects credentials when stored token and connection client bindings differ', async () => {
    const store = createMemoryStore();
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn(),
      now: () => 5_000,
      randomToken: vi.fn()
        .mockReturnValueOnce('unused-access')
        .mockReturnValueOnce('unused-refresh'),
    });
    const clientId = metadata().client_id;
    store.connections.set('user-1:legacy-connection', {
      connectionId: 'legacy-connection',
      clientId: 'https://other-client.example/mcp.json',
      clientName: 'Other MCP Client',
      redirectHost: 'other-client.example',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      createdAtMs: 1,
      lastUsedAtMs: 1,
      revokedAtMs: null,
      status: 'active',
    });
    store.accessTokens.set(hashOpaqueValue('mismatched-access'), {
      uid: 'user-1',
      connectionId: 'legacy-connection',
      clientId,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 1,
      expiresAtMs: 10_000,
    });
    store.refreshTokens.set(hashOpaqueValue('mismatched-refresh'), {
      uid: 'user-1',
      connectionId: 'legacy-connection',
      clientId,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      familyId: 'family-1',
      createdAtMs: 1,
      expiresAtMs: 10_000,
      active: true,
    });

    await expect(service.authenticateBearer(
      'mismatched-access',
      'https://quantified-self.io/mcp',
    )).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.exchangeRefreshToken({
      grant_type: 'refresh_token',
      refresh_token: 'mismatched-refresh',
      client_id: clientId,
      resource: 'https://quantified-self.io/mcp',
    }, 'https://quantified-self.io')).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('uses a canonical tombstone when disconnecting an already-revoked legacy duplicate', async () => {
    const store = createMemoryStore();
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn(),
      now: () => 5_000,
      randomToken: () => 'unused',
    });
    const clientId = metadata().client_id;
    const logicalConnectionId = buildMcpLogicalConnectionId(clientId);
    const baseConnection: McpConnection = {
      connectionId: 'legacy-a',
      clientId,
      clientName: metadata().client_name,
      redirectHost: 'client.example',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      createdAtMs: 1,
      lastUsedAtMs: 1,
      revokedAtMs: 3_000,
      status: 'revoked',
    };
    store.connections.set('user-1:legacy-a', baseConnection);
    store.connections.set('user-1:legacy-b', {
      ...baseConnection,
      connectionId: 'legacy-b',
      revokedAtMs: null,
      status: 'active',
    });
    store.accessTokens.set(hashOpaqueValue('legacy-b-access'), {
      uid: 'user-1',
      connectionId: 'legacy-b',
      clientId,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 1,
      expiresAtMs: 10_000,
    });

    const otherClientId = 'https://other-client.example/mcp.json';
    store.connections.set('user-1:other-connection', {
      ...baseConnection,
      connectionId: 'other-connection',
      clientId: otherClientId,
      clientName: 'Other MCP Client',
      revokedAtMs: null,
      status: 'active',
    });
    store.accessTokens.set(hashOpaqueValue('other-access'), {
      uid: 'user-1',
      connectionId: 'other-connection',
      clientId: otherClientId,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 1,
      expiresAtMs: 10_000,
    });

    await service.revokeConnection('user-1', 'legacy-a');

    expect(store.connections.get(`user-1:${logicalConnectionId}`)).toEqual(
      expect.objectContaining({
        connectionId: logicalConnectionId,
        clientId,
        status: 'revoked',
        revokedAtMs: 5_000,
        supersedesLegacy: true,
      }),
    );
    expect(store.connections.get('user-1:legacy-a')?.revokedAtMs).toBe(3_000);
    await expect(service.listConnections('user-1')).resolves.toEqual([
      expect.objectContaining({
        connectionId: 'other-connection',
        clientId: otherClientId,
      }),
    ]);
    await expect(service.authenticateBearer(
      'legacy-b-access',
      'https://quantified-self.io/mcp',
    )).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.authenticateBearer(
      'other-access',
      'https://quantified-self.io/mcp',
    )).resolves.toMatchObject({ connectionId: 'other-connection' });
  });

  it('does not authenticate a bearer token against a pending connection', async () => {
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
      status: 'pending',
    });
    store.accessTokens.set(hashOpaqueValue('access-token'), {
      uid: 'user-1',
      connectionId: 'connection-1',
      clientId: metadata().client_id,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 1,
      expiresAtMs: 10_000,
    });

    await expect(service.authenticateBearer(
      'access-token',
      'https://quantified-self.io/mcp',
    )).rejects.toMatchObject({
      code: 'invalid_grant',
      statusCode: 401,
    });
  });

  it('repairs a mixed-revision connection completed by the previous server version', async () => {
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
      lastUsedAtMs: 4000,
      revokedAtMs: null,
      status: 'pending',
    });
    store.accessTokens.set(hashOpaqueValue('access-token'), {
      uid: 'user-1',
      connectionId: 'connection-1',
      clientId: metadata().client_id,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 4000,
      expiresAtMs: 10_000,
    });

    await expect(service.listConnections('user-1')).resolves.toHaveLength(1);
    await expect(service.authenticateBearer(
      'access-token',
      'https://quantified-self.io/mcp',
    )).resolves.toMatchObject({
      uid: 'user-1',
      connectionId: 'connection-1',
    });
    expect(store.connections.get('user-1:connection-1')).toEqual(
      expect.objectContaining({
        status: 'active',
        lastUsedAtMs: 5000,
      }),
    );
  });

  it('fails closed when a connection is revoked during bearer authentication', async () => {
    const store = createMemoryStore();
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn(),
      now: () => 5000,
      randomToken: () => 'unused',
    });
    const connection: McpConnection = {
      connectionId: 'connection-1',
      clientId: metadata().client_id,
      clientName: metadata().client_name,
      redirectHost: 'client.example',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      createdAtMs: 1,
      lastUsedAtMs: null,
      revokedAtMs: null,
      status: 'active',
    };
    store.connections.set('user-1:connection-1', connection);
    store.accessTokens.set(hashOpaqueValue('access-token'), {
      uid: 'user-1',
      connectionId: 'connection-1',
      clientId: metadata().client_id,
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      audience: 'https://quantified-self.io/mcp',
      createdAtMs: 1,
      expiresAtMs: 10000,
    });
    store.getConnection = vi.fn().mockResolvedValue(connection);
    store.recordAuthorizedRequest = vi.fn().mockRejectedValue(
      new McpOAuthError('invalid_grant', 'revoked connection', 401),
    );

    await expect(service.authenticateBearer(
      'access-token',
      'https://quantified-self.io/mcp',
    )).rejects.toMatchObject({ statusCode: 401 });
  });

  it('shows legacy completed connections but hides legacy abandoned approvals', async () => {
    const store = createMemoryStore();
    const service = createMcpOAuthService({
      store,
      fetchClientMetadata: vi.fn(),
      now: () => 5000,
      randomToken: () => 'unused',
    });
    const baseConnection: McpConnection = {
      connectionId: 'legacy-active',
      clientId: metadata().client_id,
      clientName: metadata().client_name,
      redirectHost: 'client.example',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      createdAtMs: 1,
      lastUsedAtMs: 1000,
      revokedAtMs: null,
      audience: 'https://quantified-self.io/mcp',
      grantId: 'legacy-family',
      supersedesLegacy: false,
      pendingAuthorizationCodeHash: 'internal-code-hash',
      pendingAuthorizationApprovedAtMs: 500,
      pendingAuthorizationExpiresAtMs: 2_000,
    };
    store.connections.set('user-1:legacy-active', baseConnection);
    store.connections.set('user-1:legacy-abandoned', {
      ...baseConnection,
      connectionId: 'legacy-abandoned',
      lastUsedAtMs: null,
    });
    store.connections.set('user-1:pending', {
      ...baseConnection,
      connectionId: 'pending',
      lastUsedAtMs: null,
      status: 'pending',
    });

    const listedConnections = await service.listConnections('user-1');
    expect(listedConnections).toEqual([{
      connectionId: 'legacy-active',
      clientId: metadata().client_id,
      clientName: metadata().client_name,
      redirectHost: 'client.example',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
      createdAtMs: 1,
      lastUsedAtMs: 1000,
    }]);
    expect(JSON.stringify(listedConnections)).not.toMatch(
      /grantId|supersedesLegacy|pendingAuthorization|revokedAtMs|status|audience/,
    );
  });
});
