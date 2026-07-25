import type { LookupAddress } from 'node:dns';
import { describe, expect, it, vi } from 'vitest';
import {
  AccessTokenRecord,
  AuthorizationCodeRecord,
  AuthorizationRequestRecord,
  buildMcpRateLimitBucketId,
  ClientMetadata,
  createPinnedAddressLookup,
  createMcpOAuthService,
  createPkceChallenge,
  fetchClientMetadataDocument,
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
      const connection = connections.get(connectionKey(code.uid, code.connectionId));
      if (!connection || connection.revokedAtMs !== null) {
        throw new McpOAuthError('invalid_grant', 'revoked connection');
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
        || refresh.expiresAtMs <= input.nowMs
        || refresh.clientId !== input.clientId
        || refresh.audience !== input.audience
      ) {
        throw new McpOAuthError('invalid_grant', 'invalid refresh token');
      }
      const key = connectionKey(refresh.uid, refresh.connectionId);
      const connection = connections.get(key);
      if (!connection || connection.revokedAtMs !== null) {
        throw new McpOAuthError('invalid_grant', 'revoked connection');
      }
      if (!refresh.active) {
        connections.set(key, { ...connection, revokedAtMs: input.nowMs });
        for (const [hash, token] of accessTokens) {
          if (token.uid === refresh.uid && token.connectionId === refresh.connectionId) {
            accessTokens.delete(hash);
          }
        }
        for (const [hash, token] of refreshTokens) {
          if (token.uid === refresh.uid && token.connectionId === refresh.connectionId) {
            refreshTokens.delete(hash);
          }
        }
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
      if (
        !connection
        || connection.revokedAtMs !== null
      ) {
        throw new McpOAuthError('invalid_grant', 'revoked connection', 401);
      }
      if (token.scopes.some(scope => !connection.scopes.includes(scope))) {
        throw new McpOAuthError('invalid_grant', 'scope no longer authorized', 401);
      }
      connections.set(key, { ...connection, lastUsedAtMs: nowMs });
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
      for (const [hash, code] of codes) {
        if (code.uid === uid && code.connectionId === connectionId) {
          codes.delete(hash);
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
  it('accepts the separate activity-detail and saved-route read scopes', () => {
    expect(normalizeOAuthScopes(
      'metrics:read activity-details:read routes:read sleep:read',
    )).toEqual([
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.RoutesRead,
      MCP_OAUTH_SCOPES.SleepRead,
    ]);
    expect(() => normalizeOAuthScopes('activity-details:write')).toThrow(
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
      'connection-id',
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

  it('does not exchange an authorization code after its connection is revoked', async () => {
    const store = createMemoryStore();
    const randomValues = [
      'request-id',
      'authorization-code',
      'connection-id',
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
    const connection = store.connections.get('user-1:connection-id')!;
    store.connections.set('user-1:connection-id', {
      ...connection,
      revokedAtMs: 5000,
    });

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
});
