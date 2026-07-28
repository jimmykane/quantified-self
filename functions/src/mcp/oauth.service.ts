import * as admin from 'firebase-admin';
import { createHash, randomBytes } from 'node:crypto';
import type { LookupAddress } from 'node:dns';
import { BlockList, isIP, LookupFunction } from 'node:net';
import { Agent } from 'node:https';
import { lookup } from 'node:dns/promises';
import fetch from 'node-fetch';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  getUserDeletionGuardStateInTransaction,
} from '../shared/user-deletion-guard';

export const MCP_OAUTH_SCOPES = {
  MetricsRead: 'metrics:read',
  MeasurementsRead: 'measurements:read',
  SleepRead: 'sleep:read',
  ActivityDetailsRead: 'activity-details:read',
  ActivityLocationRead: 'activity-location:read',
  RoutesRead: 'routes:read',
  RouteLocationRead: 'route-location:read',
} as const;

export type McpOAuthScope = typeof MCP_OAUTH_SCOPES[keyof typeof MCP_OAUTH_SCOPES];

export function hasValidMcpScopeDependencies(
  scopes: readonly McpOAuthScope[],
): boolean {
  const selected = new Set(scopes);
  return !(
    selected.has(MCP_OAUTH_SCOPES.ActivityLocationRead)
    && !selected.has(MCP_OAUTH_SCOPES.ActivityDetailsRead)
  ) && !(
    selected.has(MCP_OAUTH_SCOPES.RouteLocationRead)
    && !selected.has(MCP_OAUTH_SCOPES.RoutesRead)
  );
}

export const MCP_OAUTH_COLLECTIONS = {
  authorizationRequests: 'mcpOAuthAuthorizationRequests',
  authorizationCodes: 'mcpOAuthAuthorizationCodes',
  accessTokens: 'mcpOAuthAccessTokens',
  refreshTokens: 'mcpOAuthRefreshTokens',
  rateLimits: 'mcpOAuthRateLimits',
  userConnections: 'mcpConnections',
} as const;

const AUTHORIZATION_REQUEST_LIFETIME_MS = 10 * 60 * 1000;
const AUTHORIZATION_CODE_LIFETIME_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const MCP_REQUESTS_PER_MINUTE = 120;
const MCP_AUTHORIZATION_STARTS_PER_CLIENT_PER_MINUTE = 10;
const MCP_AUTHORIZATION_STARTS_PER_REQUESTER_PER_MINUTE = 30;
const MCP_REVOCATIONS_PER_CLIENT_PER_MINUTE = 30;
const MCP_REVOCATIONS_PER_REQUESTER_PER_MINUTE = 60;
const MCP_RATE_LIMIT_DOCUMENT_LIFETIME_MS = 5 * 60 * 1000;
const MCP_OAUTH_CLEANUP_PAGE_SIZE = 50;
const MCP_OAUTH_CLEANUP_DELETE_CONCURRENCY = 10;
const MCP_OAUTH_CLEANUP_MAX_DOCUMENTS = 250;
const CLIENT_METADATA_MAX_BYTES = 64 * 1024;
const NON_PUBLIC_IPV4_ADDRESSES = new BlockList();
const NON_PUBLIC_IPV6_ADDRESSES = new BlockList();

[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].forEach(([network, prefix]) => {
  NON_PUBLIC_IPV4_ADDRESSES.addSubnet(network as string, prefix as number, 'ipv4');
});

[
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
].forEach(([network, prefix]) => {
  NON_PUBLIC_IPV6_ADDRESSES.addSubnet(network as string, prefix as number, 'ipv6');
});

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'invalid_scope'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'
  | 'access_denied'
  | 'temporarily_unavailable';

export class McpOAuthError extends Error {
  constructor(
    readonly code: OAuthErrorCode,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'McpOAuthError';
  }
}

export class McpOAuthAuthorizationRedirectError extends McpOAuthError {
  constructor(
    code: OAuthErrorCode,
    message: string,
    readonly redirectUri: string,
  ) {
    super(code, message);
    this.name = 'McpOAuthAuthorizationRedirectError';
  }
}

export interface ClientMetadata {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
}

export interface AuthorizationRequestRecord {
  requestId: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  redirectHost: string;
  codeChallenge: string;
  state: string | null;
  scopes: McpOAuthScope[];
  audience: string;
  createdAtMs: number;
  expiresAtMs: number;
  status: 'pending' | 'approved' | 'denied';
}

export interface AuthorizationCodeRecord {
  uid: string;
  connectionId: string;
  clientId: string;
  clientName?: string;
  redirectUri: string;
  redirectHost?: string;
  codeChallenge: string;
  scopes: McpOAuthScope[];
  audience: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface RefreshTokenRecord {
  uid: string;
  connectionId: string;
  clientId: string;
  scopes: McpOAuthScope[];
  audience: string;
  familyId: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface AccessTokenRecord {
  uid: string;
  connectionId: string;
  clientId: string;
  grantId?: string;
  scopes: McpOAuthScope[];
  audience: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface McpConnection {
  connectionId: string;
  clientId: string;
  clientName: string;
  redirectHost: string;
  scopes: McpOAuthScope[];
  createdAtMs: number;
  lastUsedAtMs: number | null;
  revokedAtMs: number | null;
  status?: 'pending' | 'active' | 'revoked';
  audience?: string;
  grantId?: string;
  supersedesLegacy?: boolean;
  pendingAuthorizationCodeHash?: string;
  pendingAuthorizationApprovedAtMs?: number;
  pendingAuthorizationExpiresAtMs?: number;
}

export type McpConnectionSummary = Pick<
  McpConnection,
  | 'connectionId'
  | 'clientId'
  | 'clientName'
  | 'redirectHost'
  | 'scopes'
  | 'createdAtMs'
  | 'lastUsedAtMs'
>;

interface AuthorizationApprovalInput {
  uid: string;
  requestId: string;
  grantedScopes: McpOAuthScope[];
  codeHash: string;
  codeRecord: AuthorizationCodeRecord;
  connection: McpConnection;
  nowMs: number;
}

interface AuthorizationExchangeInput {
  codeHash: string;
  clientId: string;
  redirectUri: string;
  audience: string;
  codeChallenge: string;
  accessTokenHash: string;
  accessTokenRecord: AccessTokenRecord;
  refreshTokenHash: string;
  refreshTokenRecord: RefreshTokenRecord;
  nowMs: number;
}

interface RefreshExchangeInput {
  refreshTokenHash: string;
  clientId: string;
  audience: string;
  requestedScopes: McpOAuthScope[] | null;
  nextAccessTokenHash: string;
  nextAccessTokenRecord: AccessTokenRecord;
  nextRefreshTokenHash: string;
  nextRefreshTokenRecord: RefreshTokenRecord;
  nowMs: number;
}

export interface AuthorizationStartRateLimitInput {
  clientId: string;
  requesterKey: string;
  nowMs: number;
}

export interface RevocationRateLimitInput {
  clientId: string;
  requesterKey: string;
  nowMs: number;
}

export type McpTokenTypeHint = 'access_token' | 'refresh_token' | null;

export type McpConnectionRevocationTarget =
  | {
    kind: 'owner';
    uid: string;
    connectionId: string;
  }
  | {
    kind: 'token';
    tokenHash: string;
    tokenTypeHint: McpTokenTypeHint;
    clientId: string;
  };

export interface McpOAuthStore {
  consumeAuthorizationStartRateLimit(input: AuthorizationStartRateLimitInput): Promise<void>;
  consumeRevocationRateLimit(input: RevocationRateLimitInput): Promise<void>;
  saveAuthorizationRequest(record: AuthorizationRequestRecord): Promise<void>;
  getAuthorizationRequest(requestId: string): Promise<AuthorizationRequestRecord | null>;
  approveAuthorization(input: AuthorizationApprovalInput): Promise<AuthorizationRequestRecord>;
  denyAuthorization(requestId: string, nowMs: number): Promise<AuthorizationRequestRecord>;
  exchangeAuthorizationCode(input: AuthorizationExchangeInput): Promise<AuthorizationCodeRecord>;
  exchangeRefreshToken(input: RefreshExchangeInput): Promise<RefreshTokenRecord>;
  getAccessToken(tokenHash: string): Promise<AccessTokenRecord | null>;
  getConnection(uid: string, connectionId: string): Promise<McpConnection | null>;
  recordAuthorizedRequest(token: AccessTokenRecord, nowMs: number): Promise<void>;
  listConnections(uid: string): Promise<McpConnection[]>;
  revokeConnection(target: McpConnectionRevocationTarget, nowMs: number): Promise<void>;
}

function timestamp(ms: number): Timestamp {
  return Timestamp.fromMillis(ms);
}

function documentData<T>(snapshot: admin.firestore.DocumentSnapshot): T | null {
  return snapshot.exists ? snapshot.data() as T : null;
}

function isActiveMcpConnection(connection: McpConnection | null): connection is McpConnection {
  if (!connection || connection.revokedAtMs !== null || connection.status === 'revoked') {
    return false;
  }
  return connection.status === 'active'
    || (
      (connection.status === undefined || connection.status === 'pending')
      && connection.lastUsedAtMs !== null
    );
}

function isPendingMcpConnection(connection: McpConnection | null): connection is McpConnection {
  if (!connection || connection.revokedAtMs !== null) {
    return false;
  }
  return connection.lastUsedAtMs === null
    && (connection.status === 'pending' || connection.status === undefined);
}

function isCurrentMcpGrant(
  connectionId: string,
  connection: McpConnection,
  grantId: string | undefined,
): boolean {
  const isLogicalConnection = connectionId
    === buildMcpLogicalConnectionId(connection.clientId);
  if (isLogicalConnection || connection.supersedesLegacy === true) {
    return typeof connection.grantId === 'string'
      && connection.grantId.length > 0
      && connection.grantId === grantId;
  }
  return connection.grantId === undefined || connection.grantId === grantId;
}

function isSupersededLegacyConnection(
  connectionId: string,
  logicalConnection: McpConnection | null,
): boolean {
  return logicalConnection?.supersedesLegacy === true
    && logicalConnection.connectionId !== connectionId;
}

function toMcpConnectionSummary(connection: McpConnection): McpConnectionSummary {
  return {
    connectionId: connection.connectionId,
    clientId: connection.clientId,
    clientName: connection.clientName,
    redirectHost: connection.redirectHost,
    scopes: connection.scopes,
    createdAtMs: connection.createdAtMs,
    lastUsedAtMs: connection.lastUsedAtMs,
  };
}

export function buildFirestoreMcpOAuthStore(): McpOAuthStore {
  const db = admin.firestore();
  const collection = (name: string) => db.collection(name);
  const connectionRef = (uid: string, connectionId: string) => db
    .collection('users')
    .doc(uid)
    .collection(MCP_OAUTH_COLLECTIONS.userConnections)
    .doc(connectionId);
  const markConnectionRevoked = (
    transaction: admin.firestore.Transaction,
    ref: admin.firestore.DocumentReference,
    nowMs: number,
    options: {
      clearPendingAuthorization: boolean;
      revokedAtMs?: number | null;
      supersedesLegacy?: boolean;
    },
  ): void => {
    transaction.set(ref, {
      status: 'revoked',
      revokedAtMs: options.revokedAtMs ?? nowMs,
      expireAt: FieldValue.delete(),
      ...(options.supersedesLegacy === true ? { supersedesLegacy: true } : {}),
      ...(options.clearPendingAuthorization
        ? {
          pendingAuthorizationCodeHash: FieldValue.delete(),
          pendingAuthorizationApprovedAtMs: FieldValue.delete(),
          pendingAuthorizationExpiresAtMs: FieldValue.delete(),
        }
        : {}),
    }, { merge: true });
  };

  return {
    async consumeAuthorizationStartRateLimit(input) {
      const windowStartMs = Math.floor(input.nowMs / 60000) * 60000;
      const clientRateLimitRef = collection(MCP_OAUTH_COLLECTIONS.rateLimits).doc(
        buildMcpAuthorizationStartRateLimitBucketId(
          'authorization_start_client',
          input.clientId,
          windowStartMs,
        ),
      );
      const requesterRateLimitRef = collection(MCP_OAUTH_COLLECTIONS.rateLimits).doc(
        buildMcpAuthorizationStartRateLimitBucketId(
          'authorization_start_requester',
          input.requesterKey,
          windowStartMs,
        ),
      );

      await db.runTransaction(async (transaction) => {
        const clientRateLimit = documentData<{ count?: number }>(
          await transaction.get(clientRateLimitRef),
        );
        const requesterRateLimit = documentData<{ count?: number }>(
          await transaction.get(requesterRateLimitRef),
        );
        const nextClientCount = Number(clientRateLimit?.count || 0) + 1;
        const nextRequesterCount = Number(requesterRateLimit?.count || 0) + 1;
        if (
          nextClientCount > MCP_AUTHORIZATION_STARTS_PER_CLIENT_PER_MINUTE
          || nextRequesterCount > MCP_AUTHORIZATION_STARTS_PER_REQUESTER_PER_MINUTE
        ) {
          throw new McpOAuthError(
            'temporarily_unavailable',
            'The authorization request rate limit was exceeded.',
            429,
          );
        }

        const expireAt = timestamp(windowStartMs + MCP_RATE_LIMIT_DOCUMENT_LIFETIME_MS);
        transaction.set(clientRateLimitRef, {
          rateLimitType: 'authorization_start_client',
          windowStartMs,
          count: nextClientCount,
          expireAt,
        });
        transaction.set(requesterRateLimitRef, {
          rateLimitType: 'authorization_start_requester',
          windowStartMs,
          count: nextRequesterCount,
          expireAt,
        });
      });
    },

    async consumeRevocationRateLimit(input) {
      const windowStartMs = Math.floor(input.nowMs / 60000) * 60000;
      const clientRateLimitRef = collection(MCP_OAUTH_COLLECTIONS.rateLimits).doc(
        buildMcpRevocationRateLimitBucketId(
          'revocation_client',
          input.clientId,
          windowStartMs,
        ),
      );
      const requesterRateLimitRef = collection(MCP_OAUTH_COLLECTIONS.rateLimits).doc(
        buildMcpRevocationRateLimitBucketId(
          'revocation_requester',
          input.requesterKey,
          windowStartMs,
        ),
      );

      await db.runTransaction(async (transaction) => {
        const clientRateLimit = documentData<{ count?: number }>(
          await transaction.get(clientRateLimitRef),
        );
        const requesterRateLimit = documentData<{ count?: number }>(
          await transaction.get(requesterRateLimitRef),
        );
        const nextClientCount = Number(clientRateLimit?.count || 0) + 1;
        const nextRequesterCount = Number(requesterRateLimit?.count || 0) + 1;
        if (
          nextClientCount > MCP_REVOCATIONS_PER_CLIENT_PER_MINUTE
          || nextRequesterCount > MCP_REVOCATIONS_PER_REQUESTER_PER_MINUTE
        ) {
          throw new McpOAuthError(
            'temporarily_unavailable',
            'The token revocation rate limit was exceeded.',
            429,
          );
        }

        const expireAt = timestamp(windowStartMs + MCP_RATE_LIMIT_DOCUMENT_LIFETIME_MS);
        transaction.set(clientRateLimitRef, {
          rateLimitType: 'revocation_client',
          windowStartMs,
          count: nextClientCount,
          expireAt,
        });
        transaction.set(requesterRateLimitRef, {
          rateLimitType: 'revocation_requester',
          windowStartMs,
          count: nextRequesterCount,
          expireAt,
        });
      });
    },

    async saveAuthorizationRequest(record) {
      await collection(MCP_OAUTH_COLLECTIONS.authorizationRequests).doc(record.requestId).create({
        ...record,
        expireAt: timestamp(record.expiresAtMs),
      });
    },

    async getAuthorizationRequest(requestId) {
      return documentData<AuthorizationRequestRecord>(
        await collection(MCP_OAUTH_COLLECTIONS.authorizationRequests).doc(requestId).get(),
      );
    },

    async approveAuthorization(input) {
      const requestRef = collection(MCP_OAUTH_COLLECTIONS.authorizationRequests).doc(input.requestId);
      const codeRef = collection(MCP_OAUTH_COLLECTIONS.authorizationCodes).doc(input.codeHash);
      const pendingConnectionRef = connectionRef(
        input.uid,
        input.connection.connectionId,
      );
      return db.runTransaction(async (transaction) => {
        const guard = await getUserDeletionGuardStateInTransaction(db, transaction, input.uid, input.nowMs);
        if (guard.shouldSkip) {
          throw new McpOAuthError('access_denied', 'This account is no longer available.', 403);
        }
        const request = documentData<AuthorizationRequestRecord>(await transaction.get(requestRef));
        if (!request || request.status !== 'pending' || request.expiresAtMs <= input.nowMs) {
          throw new McpOAuthError('invalid_request', 'The authorization request is no longer valid.');
        }
        const existingConnection = documentData<McpConnection>(
          await transaction.get(pendingConnectionRef),
        );
        if (
          existingConnection
          && existingConnection.clientId !== input.connection.clientId
        ) {
          throw new McpOAuthError(
            'invalid_request',
            'The MCP connection identity is no longer valid.',
          );
        }
        transaction.update(requestRef, {
          status: 'approved',
          approvedAtMs: input.nowMs,
          uid: input.uid,
          grantedScopes: input.grantedScopes,
        });
        transaction.create(codeRef, {
          ...input.codeRecord,
          expireAt: timestamp(input.codeRecord.expiresAtMs),
        });
        if (!existingConnection || isPendingMcpConnection(existingConnection)) {
          const pendingConnection = {
            ...input.connection,
            status: 'pending',
            pendingAuthorizationCodeHash: input.codeHash,
            pendingAuthorizationApprovedAtMs: input.nowMs,
            pendingAuthorizationExpiresAtMs: input.codeRecord.expiresAtMs,
            expireAt: timestamp(input.codeRecord.expiresAtMs),
          };
          if (existingConnection) {
            transaction.set(pendingConnectionRef, pendingConnection);
          } else {
            transaction.create(pendingConnectionRef, pendingConnection);
          }
        } else {
          // Keep an existing active grant usable, or an existing revocation
          // authoritative, until this newly approved code is actually
          // exchanged. Owner-authoritative disconnect clears this marker;
          // revoking only the current grant intentionally preserves it.
          transaction.set(pendingConnectionRef, {
            pendingAuthorizationCodeHash: input.codeHash,
            pendingAuthorizationApprovedAtMs: input.nowMs,
            pendingAuthorizationExpiresAtMs: input.codeRecord.expiresAtMs,
          }, { merge: true });
        }
        return request;
      });
    },

    async denyAuthorization(requestId, nowMs) {
      const requestRef = collection(MCP_OAUTH_COLLECTIONS.authorizationRequests).doc(requestId);
      return db.runTransaction(async (transaction) => {
        const request = documentData<AuthorizationRequestRecord>(await transaction.get(requestRef));
        if (!request || request.status !== 'pending' || request.expiresAtMs <= nowMs) {
          throw new McpOAuthError('invalid_request', 'The authorization request is no longer valid.');
        }
        transaction.update(requestRef, {
          status: 'denied',
          deniedAtMs: nowMs,
        });
        return request;
      });
    },

    async exchangeAuthorizationCode(input) {
      const codeRef = collection(MCP_OAUTH_COLLECTIONS.authorizationCodes).doc(input.codeHash);
      return db.runTransaction(async (transaction) => {
        const code = documentData<AuthorizationCodeRecord>(await transaction.get(codeRef));
        if (
          !code
          || code.expiresAtMs <= input.nowMs
          || code.clientId !== input.clientId
          || code.redirectUri !== input.redirectUri
          || code.audience !== input.audience
          || code.codeChallenge !== input.codeChallenge
        ) {
          throw new McpOAuthError('invalid_grant', 'The authorization code is invalid or expired.');
        }
        const guard = await getUserDeletionGuardStateInTransaction(db, transaction, code.uid, input.nowMs);
        if (guard.shouldSkip) {
          throw new McpOAuthError('invalid_grant', 'The authorization grant is no longer valid.');
        }
        const activeConnectionRef = connectionRef(code.uid, code.connectionId);
        const connection = documentData<McpConnection>(
          await transaction.get(activeConnectionRef),
        );
        const logicalConnectionId = buildMcpLogicalConnectionId(code.clientId);
        const isLogicalConnection = code.connectionId === logicalConnectionId;
        const validConnectionState = isLogicalConnection
          ? (
            connection?.pendingAuthorizationCodeHash === input.codeHash
            && Number(connection.pendingAuthorizationExpiresAtMs || 0) > input.nowMs
          )
          : isPendingMcpConnection(connection);
        if (
          !connection
          || connection.clientId !== code.clientId
          || !validConnectionState
        ) {
          throw new McpOAuthError('invalid_grant', 'The MCP connection is no longer available.');
        }
        const clientName = code.clientName || connection.clientName;
        const redirectHost = code.redirectHost || connection.redirectHost;
        if (!clientName || !redirectHost) {
          throw new McpOAuthError('invalid_grant', 'The MCP connection metadata is incomplete.');
        }
        const grantId = input.refreshTokenRecord.familyId;
        transaction.delete(codeRef);
        transaction.create(
          collection(MCP_OAUTH_COLLECTIONS.accessTokens).doc(input.accessTokenHash),
          {
            ...input.accessTokenRecord,
            uid: code.uid,
            connectionId: code.connectionId,
            grantId,
            scopes: code.scopes,
            expireAt: timestamp(input.accessTokenRecord.expiresAtMs),
          },
        );
        transaction.create(
          collection(MCP_OAUTH_COLLECTIONS.refreshTokens).doc(input.refreshTokenHash),
          {
            ...input.refreshTokenRecord,
            uid: code.uid,
            connectionId: code.connectionId,
            scopes: code.scopes,
            active: true,
            expireAt: timestamp(input.refreshTokenRecord.expiresAtMs),
          },
        );
        transaction.set(activeConnectionRef, {
          connectionId: code.connectionId,
          clientId: code.clientId,
          clientName,
          redirectHost,
          scopes: code.scopes,
          audience: code.audience,
          grantId,
          supersedesLegacy: isLogicalConnection || connection.supersedesLegacy === true,
          createdAtMs: input.nowMs,
          status: 'active',
          lastUsedAtMs: input.nowMs,
          revokedAtMs: null,
          expireAt: FieldValue.delete(),
          pendingAuthorizationCodeHash: FieldValue.delete(),
          pendingAuthorizationApprovedAtMs: FieldValue.delete(),
          pendingAuthorizationExpiresAtMs: FieldValue.delete(),
        }, { merge: true });
        return code;
      });
    },

    async exchangeRefreshToken(input) {
      const refreshRef = collection(MCP_OAUTH_COLLECTIONS.refreshTokens).doc(input.refreshTokenHash);
      const outcome = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(refreshRef);
        const refresh = documentData<RefreshTokenRecord & { active?: boolean }>(snapshot);
        if (
          !refresh
          || refresh.expiresAtMs <= input.nowMs
          || refresh.clientId !== input.clientId
          || refresh.audience !== input.audience
        ) {
          throw new McpOAuthError('invalid_grant', 'The refresh token is invalid or expired.');
        }
        const guard = await getUserDeletionGuardStateInTransaction(db, transaction, refresh.uid, input.nowMs);
        if (guard.shouldSkip) {
          throw new McpOAuthError('invalid_grant', 'The authorization grant is no longer valid.');
        }
        const activeConnectionRef = connectionRef(refresh.uid, refresh.connectionId);
        const connection = documentData<McpConnection>(
          await transaction.get(activeConnectionRef),
        );
        const logicalConnectionId = buildMcpLogicalConnectionId(refresh.clientId);
        const logicalConnection = refresh.connectionId === logicalConnectionId
          ? connection
          : documentData<McpConnection>(
            await transaction.get(connectionRef(refresh.uid, logicalConnectionId)),
          );
        if (
          connection?.clientId !== refresh.clientId
          || (
            logicalConnection
            && logicalConnection.clientId !== refresh.clientId
          )
        ) {
          throw new McpOAuthError('invalid_grant', 'The MCP client binding is invalid.');
        }
        if (isSupersededLegacyConnection(refresh.connectionId, logicalConnection)) {
          throw new McpOAuthError('invalid_grant', 'The authorization grant was superseded.');
        }
        if (!isActiveMcpConnection(connection)) {
          throw new McpOAuthError('invalid_grant', 'The MCP connection is no longer active.');
        }
        if (!isCurrentMcpGrant(refresh.connectionId, connection, refresh.familyId)) {
          throw new McpOAuthError('invalid_grant', 'The authorization grant was superseded.');
        }
        if (refresh.active !== true) {
          markConnectionRevoked(transaction, activeConnectionRef, input.nowMs, {
            clearPendingAuthorization: false,
            revokedAtMs: connection.revokedAtMs,
          });
          return { refresh, replayed: true as const };
        }
        if (
          input.requestedScopes
          && input.requestedScopes.some(scope => !refresh.scopes.includes(scope))
        ) {
          throw new McpOAuthError(
            'invalid_scope',
            'The requested scope exceeds the refresh token grant.',
          );
        }
        const nextScopes = input.requestedScopes || refresh.scopes;
        if (
          !hasValidMcpScopeDependencies(refresh.scopes)
          || !hasValidMcpScopeDependencies(nextScopes)
        ) {
          throw new McpOAuthError(
            'invalid_scope',
            'The authorization grant contains an invalid dependent scope.',
          );
        }
        transaction.update(refreshRef, {
          active: false,
          rotatedAtMs: input.nowMs,
        });
        transaction.create(
          collection(MCP_OAUTH_COLLECTIONS.accessTokens).doc(input.nextAccessTokenHash),
          {
            ...input.nextAccessTokenRecord,
            uid: refresh.uid,
            connectionId: refresh.connectionId,
            grantId: refresh.familyId,
            scopes: nextScopes,
            expireAt: timestamp(input.nextAccessTokenRecord.expiresAtMs),
          },
        );
        transaction.create(
          collection(MCP_OAUTH_COLLECTIONS.refreshTokens).doc(input.nextRefreshTokenHash),
          {
            ...input.nextRefreshTokenRecord,
            uid: refresh.uid,
            connectionId: refresh.connectionId,
            scopes: nextScopes,
            familyId: refresh.familyId,
            active: true,
            expireAt: timestamp(input.nextRefreshTokenRecord.expiresAtMs),
          },
        );
        transaction.update(activeConnectionRef, {
          status: 'active',
          scopes: nextScopes,
          lastUsedAtMs: input.nowMs,
          expireAt: FieldValue.delete(),
        });
        return { refresh, replayed: false as const };
      });
      if (outcome.replayed) {
        throw new McpOAuthError(
          'invalid_grant',
          'Refresh-token reuse was detected and the MCP connection was revoked.',
        );
      }
      return outcome.refresh;
    },

    async getAccessToken(tokenHash) {
      return documentData<AccessTokenRecord>(
        await collection(MCP_OAUTH_COLLECTIONS.accessTokens).doc(tokenHash).get(),
      );
    },

    async getConnection(uid, connectionId) {
      return documentData<McpConnection>(await connectionRef(uid, connectionId).get());
    },

    async recordAuthorizedRequest(token, nowMs) {
      const windowStartMs = Math.floor(nowMs / 60000) * 60000;
      const rateLimitId = buildMcpRateLimitBucketId(token, windowStartMs);
      const rateLimitRef = collection(MCP_OAUTH_COLLECTIONS.rateLimits).doc(rateLimitId);
      const activeConnectionRef = connectionRef(token.uid, token.connectionId);
      await db.runTransaction(async (transaction) => {
        const guard = await getUserDeletionGuardStateInTransaction(
          db,
          transaction,
          token.uid,
          nowMs,
        );
        if (guard.shouldSkip) {
          throw new McpOAuthError(
            'invalid_grant',
            'The MCP account is no longer available.',
            401,
          );
        }
        const rateLimit = documentData<{ count?: number }>(await transaction.get(rateLimitRef));
        const connection = documentData<McpConnection>(
          await transaction.get(activeConnectionRef),
        );
        const logicalConnectionId = buildMcpLogicalConnectionId(token.clientId);
        const logicalConnection = token.connectionId === logicalConnectionId
          ? connection
          : documentData<McpConnection>(
            await transaction.get(connectionRef(token.uid, logicalConnectionId)),
          );
        if (
          connection?.clientId !== token.clientId
          || (
            logicalConnection
            && logicalConnection.clientId !== token.clientId
          )
        ) {
          throw new McpOAuthError(
            'invalid_grant',
            'The MCP client binding is invalid.',
            401,
          );
        }
        if (isSupersededLegacyConnection(token.connectionId, logicalConnection)) {
          throw new McpOAuthError(
            'invalid_grant',
            'The MCP connection was superseded.',
            401,
          );
        }
        if (!isActiveMcpConnection(connection)) {
          throw new McpOAuthError('invalid_grant', 'The MCP connection is no longer active.', 401);
        }
        if (!isCurrentMcpGrant(token.connectionId, connection, token.grantId)) {
          throw new McpOAuthError(
            'invalid_grant',
            'The MCP authorization grant was superseded.',
            401,
          );
        }
        if (token.scopes.some(scope => !connection.scopes.includes(scope))) {
          throw new McpOAuthError(
            'invalid_grant',
            'The MCP connection no longer authorizes this access token.',
            401,
          );
        }
        const nextCount = Number(rateLimit?.count || 0) + 1;
        if (nextCount > MCP_REQUESTS_PER_MINUTE) {
          throw new McpOAuthError('temporarily_unavailable', 'The MCP request rate limit was exceeded.', 429);
        }
        transaction.set(rateLimitRef, {
          uid: token.uid,
          connectionId: token.connectionId,
          windowStartMs,
          count: nextCount,
          expireAt: timestamp(windowStartMs + MCP_RATE_LIMIT_DOCUMENT_LIFETIME_MS),
        });
        transaction.update(activeConnectionRef, {
          status: 'active',
          lastUsedAtMs: nowMs,
          expireAt: FieldValue.delete(),
        });
      });
    },

    async listConnections(uid) {
      const snapshot = await db.collection('users')
        .doc(uid)
        .collection(MCP_OAUTH_COLLECTIONS.userConnections)
        .orderBy('createdAtMs', 'desc')
        .get();
      return snapshot.docs.map(doc => ({
        ...doc.data(),
        connectionId: doc.id,
      })) as McpConnection[];
    },

    async revokeConnection(target, nowMs) {
      await db.runTransaction(async (transaction) => {
        let uid: string;
        let connectionId: string;
        let expectedClientId: string | null = null;
        let matchedToken: AccessTokenRecord | RefreshTokenRecord | null = null;

        if (target.kind === 'token') {
          // OAuth credential documents are keyed by SHA-256 token hashes. Keep
          // this lookup to the same two primary-key reads below; never scan
          // by ownership or persist/query the submitted raw token.
          const collectionOrder = target.tokenTypeHint === 'refresh_token'
            ? [
              MCP_OAUTH_COLLECTIONS.refreshTokens,
              MCP_OAUTH_COLLECTIONS.accessTokens,
            ]
            : [
              MCP_OAUTH_COLLECTIONS.accessTokens,
              MCP_OAUTH_COLLECTIONS.refreshTokens,
            ];
          for (const collectionName of collectionOrder) {
            const candidate = documentData<AccessTokenRecord | RefreshTokenRecord>(
              await transaction.get(
                collection(collectionName).doc(target.tokenHash),
              ),
            );
            if (
              !matchedToken
              && candidate
              && candidate.clientId === target.clientId
              && candidate.expiresAtMs > nowMs
            ) {
              matchedToken = candidate;
            }
          }

          if (!matchedToken) {
            return;
          }
          uid = matchedToken.uid;
          connectionId = matchedToken.connectionId;
          expectedClientId = target.clientId;
        } else {
          uid = target.uid;
          connectionId = target.connectionId;
        }

        const guard = await getUserDeletionGuardStateInTransaction(
          db,
          transaction,
          uid,
          nowMs,
        );
        if (guard.shouldSkip) {
          return;
        }
        const ref = connectionRef(uid, connectionId);
        const connection = await transaction.get(ref);
        if (!connection.exists) {
          return;
        }
        const current = documentData<McpConnection>(connection);
        if (!current || (expectedClientId !== null && current.clientId !== expectedClientId)) {
          return;
        }
        if (target.kind === 'token') {
          if (current.status === 'revoked' || current.revokedAtMs !== null) {
            return;
          }
          const tokenGrantId = matchedToken && 'familyId' in matchedToken
            ? matchedToken.familyId
            : matchedToken?.grantId;
          if (!isCurrentMcpGrant(connectionId, current, tokenGrantId)) {
            return;
          }
          markConnectionRevoked(transaction, ref, nowMs, {
            clearPendingAuthorization: false,
            revokedAtMs: current.revokedAtMs,
          });
          return;
        }

        const logicalConnectionId = buildMcpLogicalConnectionId(current.clientId);
        if (connectionId === logicalConnectionId) {
          markConnectionRevoked(transaction, ref, nowMs, {
            clearPendingAuthorization: true,
            revokedAtMs: current.revokedAtMs,
            supersedesLegacy: true,
          });
          return;
        }

        const logicalRef = connectionRef(uid, logicalConnectionId);
        const logicalConnection = documentData<McpConnection>(
          await transaction.get(logicalRef),
        );
        if (
          logicalConnection
          && logicalConnection.clientId !== current.clientId
        ) {
          throw new McpOAuthError(
            'invalid_grant',
            'The MCP connection identity is no longer valid.',
          );
        }
        markConnectionRevoked(transaction, ref, nowMs, {
          clearPendingAuthorization: true,
          revokedAtMs: current.revokedAtMs,
        });
        transaction.set(logicalRef, {
          connectionId: logicalConnectionId,
          clientId: current.clientId,
          clientName: logicalConnection?.clientName || current.clientName,
          redirectHost: logicalConnection?.redirectHost || current.redirectHost,
          scopes: logicalConnection?.scopes || current.scopes,
          createdAtMs: logicalConnection?.createdAtMs || current.createdAtMs,
          lastUsedAtMs: logicalConnection?.lastUsedAtMs ?? current.lastUsedAtMs,
          revokedAtMs: logicalConnection?.revokedAtMs ?? nowMs,
          status: 'revoked',
          supersedesLegacy: true,
          expireAt: FieldValue.delete(),
          pendingAuthorizationCodeHash: FieldValue.delete(),
          pendingAuthorizationApprovedAtMs: FieldValue.delete(),
          pendingAuthorizationExpiresAtMs: FieldValue.delete(),
          ...(logicalConnection?.audience || current.audience
            ? { audience: logicalConnection?.audience || current.audience }
            : {}),
          ...(logicalConnection?.grantId || current.grantId
            ? { grantId: logicalConnection?.grantId || current.grantId }
            : {}),
        }, { merge: true });
      });
    },
  };
}

function randomOpaqueValue(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

export function hashOpaqueValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

export function buildMcpLogicalConnectionId(clientId: string): string {
  return hashOpaqueValue(`mcp-logical-connection-v1:${clientId}`);
}

export function buildMcpRateLimitBucketId(
  token: Pick<AccessTokenRecord, 'uid' | 'connectionId'>,
  windowStartMs: number,
): string {
  return hashOpaqueValue(`${token.uid}:${token.connectionId}:${windowStartMs}`);
}

export type McpAuthorizationStartRateLimitType =
  | 'authorization_start_client'
  | 'authorization_start_requester';

export function buildMcpAuthorizationStartRateLimitBucketId(
  rateLimitType: McpAuthorizationStartRateLimitType,
  key: string,
  windowStartMs: number,
): string {
  return hashOpaqueValue(`${rateLimitType}:${key}:${windowStartMs}`);
}

export type McpRevocationRateLimitType =
  | 'revocation_client'
  | 'revocation_requester';

export function buildMcpRevocationRateLimitBucketId(
  rateLimitType: McpRevocationRateLimitType,
  key: string,
  windowStartMs: number,
): string {
  return hashOpaqueValue(`${rateLimitType}:${key}:${windowStartMs}`);
}

export function createPkceChallenge(verifier: string): string {
  return hashOpaqueValue(verifier);
}

function requireString(value: unknown, name: string, maxLength = 2048): string {
  const exact = typeof value === 'string' ? value : '';
  if (!exact || !exact.trim() || exact.length > maxLength) {
    throw new McpOAuthError('invalid_request', `${name} is required.`);
  }
  return exact;
}

function requireOpaqueDocumentId(value: unknown, name: string): string {
  const exact = requireString(value, name, 256);
  if (!/^[A-Za-z0-9_-]+$/.test(exact)) {
    throw new McpOAuthError('invalid_request', `${name} is invalid.`);
  }
  return exact;
}

function parseClientMetadataDocumentUrl(clientId: string): URL {
  if (clientId !== clientId.trim()) {
    throw new McpOAuthError(
      'invalid_client',
      'client_id must be an HTTPS metadata document URL with a path.',
    );
  }
  let clientUrl: URL;
  try {
    clientUrl = new URL(clientId);
  } catch {
    throw new McpOAuthError(
      'invalid_client',
      'client_id must be an HTTPS metadata document URL.',
    );
  }
  const literalHostname = clientUrl.hostname.replace(/^\[|\]$/g, '');
  if (
    clientUrl.protocol !== 'https:'
    || clientUrl.pathname === '/'
    || clientUrl.username
    || clientUrl.password
    || clientUrl.hash
    || clientUrl.hostname === 'localhost'
    || (isIP(literalHostname) !== 0 && isPrivateAddress(literalHostname))
  ) {
    throw new McpOAuthError(
      'invalid_client',
      'client_id must be an HTTPS metadata document URL with a path.',
    );
  }
  return clientUrl;
}

function requirePublicClientId(value: unknown): string {
  const clientId = requireString(value, 'client_id');
  parseClientMetadataDocumentUrl(clientId);
  return clientId;
}

function readMcpTokenTypeHint(value: unknown): McpTokenTypeHint {
  return value === 'access_token' || value === 'refresh_token'
    ? value
    : null;
}

function readOptionalOAuthState(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !/^[\x20-\x7E]{1,512}$/.test(value)) {
    throw new McpOAuthError('invalid_request', 'state is invalid.');
  }
  return value;
}

export function normalizeOAuthScopes(value: unknown): McpOAuthScope[] {
  const requested = Array.isArray(value)
    ? value.map(scope => `${scope}`)
    : `${value || ''}`.split(/\s+/);
  const unique = [...new Set(requested.map(scope => scope.trim()).filter(Boolean))];
  if (
    !unique.length
    || unique.some(scope => !Object.values(MCP_OAUTH_SCOPES).includes(scope as McpOAuthScope))
  ) {
    throw new McpOAuthError(
      'invalid_scope',
      `Only ${Object.values(MCP_OAUTH_SCOPES).join(', ')} can be requested.`,
    );
  }
  if (!hasValidMcpScopeDependencies(unique as McpOAuthScope[])) {
    throw new McpOAuthError(
      'invalid_scope',
      'Location scopes require their matching activity-detail or saved-route scope.',
    );
  }
  return unique as McpOAuthScope[];
}

export function rejectRepeatedOAuthParameters(params: Record<string, unknown>): void {
  if (Object.values(params).some(Array.isArray)) {
    throw new McpOAuthError(
      'invalid_request',
      'OAuth request parameters must not be included more than once.',
    );
  }
}

function normalizeOAuthScopeParameter(value: unknown): McpOAuthScope[] {
  if (typeof value !== 'string') {
    throw new McpOAuthError('invalid_scope', 'OAuth scope must be a single space-delimited string.');
  }
  return normalizeOAuthScopes(value);
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return NON_PUBLIC_IPV4_ADDRESSES.check(address, 'ipv4');
  }
  if (family === 6) {
    return NON_PUBLIC_IPV6_ADDRESSES.check(address, 'ipv6');
  }
  return true;
}

export function createPinnedAddressLookup(
  addresses: readonly LookupAddress[],
): LookupFunction {
  const pinnedAddresses = [
    ...new Map(addresses.map(address => [
      `${address.family}:${address.address}`,
      { ...address },
    ])).values(),
  ];
  return (_hostname, options, callback) => {
    const requestedFamily = options.family === 'IPv4'
      ? 4
      : options.family === 'IPv6'
        ? 6
        : Number(options.family) || 0;
    const matchingAddresses = pinnedAddresses.filter(candidate => (
      requestedFamily === 0 || candidate.family === requestedFamily
    ));
    const address = matchingAddresses[0];
    if (!address) {
      const error = new Error('No pinned client metadata address is available.') as NodeJS.ErrnoException;
      error.code = 'ENOTFOUND';
      callback(error, '');
      return;
    }
    if (options.all) {
      callback(null, matchingAddresses);
      return;
    }
    callback(null, address.address, address.family);
  };
}

function validateRedirectUri(value: string): URL {
  if (value !== value.trim()) {
    throw new McpOAuthError('invalid_client', 'Client metadata contains an invalid redirect URI.');
  }
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    throw new McpOAuthError('invalid_client', 'Client metadata contains an invalid redirect URI.');
  }
  const isLoopback = uri.hostname === 'localhost'
    || uri.hostname === '127.0.0.1'
    || uri.hostname === '[::1]';
  if (uri.protocol !== 'https:' && !(isLoopback && uri.protocol === 'http:')) {
    throw new McpOAuthError('invalid_client', 'Redirect URIs must use HTTPS or an HTTP loopback address.');
  }
  if (uri.username || uri.password || uri.hash) {
    throw new McpOAuthError('invalid_client', 'Client redirect URIs cannot contain credentials or fragments.');
  }
  return uri;
}

function isBoundedStringArray(value: unknown, maxLength: number): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= maxLength
    && value.every(item => typeof item === 'string');
}

export function validateClientMetadataDocument(
  value: unknown,
  clientId: string,
): ClientMetadata {
  const metadata = value && typeof value === 'object'
    ? value as Partial<ClientMetadata>
    : null;
  if (
    !metadata
    || metadata.client_id !== clientId
    || typeof metadata.client_name !== 'string'
    || !metadata.client_name.trim()
    || metadata.client_name.length > 120
    || !isBoundedStringArray(metadata.redirect_uris, 20)
    || (
      metadata.grant_types !== undefined
      && !isBoundedStringArray(metadata.grant_types, 20)
    )
    || (
      metadata.response_types !== undefined
      && !isBoundedStringArray(metadata.response_types, 20)
    )
    || (
      metadata.token_endpoint_auth_method !== undefined
      && typeof metadata.token_endpoint_auth_method !== 'string'
    )
  ) {
    throw new McpOAuthError('invalid_client', 'The client metadata document is invalid.');
  }

  metadata.redirect_uris.forEach(validateRedirectUri);
  if (
    metadata.grant_types
    && !metadata.grant_types.includes('authorization_code')
  ) {
    throw new McpOAuthError('invalid_client', 'The client does not support the authorization code grant.');
  }
  if (metadata.response_types && !metadata.response_types.includes('code')) {
    throw new McpOAuthError('invalid_client', 'The client does not support authorization codes.');
  }
  if (
    metadata.token_endpoint_auth_method !== undefined
    && metadata.token_endpoint_auth_method !== 'none'
  ) {
    throw new McpOAuthError('invalid_client', 'Only public PKCE clients are supported.');
  }

  return {
    client_id: metadata.client_id,
    client_name: metadata.client_name.trim(),
    redirect_uris: [...metadata.redirect_uris],
    ...(metadata.grant_types ? { grant_types: [...metadata.grant_types] } : {}),
    ...(metadata.response_types ? { response_types: [...metadata.response_types] } : {}),
    ...(metadata.token_endpoint_auth_method !== undefined
      ? { token_endpoint_auth_method: metadata.token_endpoint_auth_method }
      : {}),
  };
}

export async function fetchClientMetadataDocument(clientId: string): Promise<ClientMetadata> {
  const clientUrl = parseClientMetadataDocumentUrl(clientId);

  const addresses = await lookup(clientUrl.hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some(result => isPrivateAddress(result.address))) {
    throw new McpOAuthError('invalid_client', 'The client metadata host is not publicly routable.');
  }
  const agent = new Agent({
    lookup: createPinnedAddressLookup(addresses),
  });

  let response;
  try {
    response = await fetch(clientUrl.toString(), {
      method: 'GET',
      redirect: 'error',
      timeout: 5000,
      size: CLIENT_METADATA_MAX_BYTES,
      headers: {
        accept: 'application/json',
        'user-agent': 'quantified-self-mcp-oauth/1.0',
      },
      agent,
    });
  } catch {
    throw new McpOAuthError('invalid_client', 'The client metadata document could not be retrieved.');
  }
  if (!response.ok) {
    throw new McpOAuthError('invalid_client', 'The client metadata document could not be retrieved.');
  }

  return validateClientMetadataDocument(
    await response.json().catch(() => null),
    clientId,
  );
}

export interface McpOAuthServiceDependencies {
  store: McpOAuthStore;
  fetchClientMetadata: (clientId: string) => Promise<ClientMetadata>;
  now: () => number;
  randomToken: (byteLength?: number) => string;
}

export interface McpAuthorizationStartContext {
  requesterKey?: string;
}

export interface McpRevocationContext {
  requesterKey?: string;
}

function normalizeOAuthRequesterKey(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    ? value
    : 'unknown';
}

export function createMcpOAuthService(
  dependencies?: McpOAuthServiceDependencies,
) {
  const resolvedDependencies = dependencies || {
    store: buildFirestoreMcpOAuthStore(),
    fetchClientMetadata: fetchClientMetadataDocument,
    now: () => Date.now(),
    randomToken: randomOpaqueValue,
  };
  const { store } = resolvedDependencies;

  return {
    async startAuthorization(
      params: Record<string, unknown>,
      baseUrl: string,
      context?: McpAuthorizationStartContext,
    ) {
      const clientId = requireString(params.client_id, 'client_id');
      const redirectUri = requireString(params.redirect_uri, 'redirect_uri');
      const nowMs = resolvedDependencies.now();
      await store.consumeAuthorizationStartRateLimit({
        clientId,
        requesterKey: normalizeOAuthRequesterKey(context?.requesterKey),
        nowMs,
      });
      const metadata = await resolvedDependencies.fetchClientMetadata(clientId);
      if (!metadata.redirect_uris.includes(redirectUri)) {
        throw new McpOAuthError('invalid_client', 'redirect_uri is not registered by the client metadata document.');
      }
      const redirectHost = validateRedirectUri(redirectUri).host;
      let state: string | null = null;
      let codeChallenge: string;
      let audience: string;
      let scopes: McpOAuthScope[];
      try {
        rejectRepeatedOAuthParameters(params);
        state = readOptionalOAuthState(params.state);
        if (params.response_type === undefined || params.response_type === null || params.response_type === '') {
          throw new McpOAuthError('invalid_request', 'response_type is required.');
        }
        if (params.response_type !== 'code') {
          throw new McpOAuthError(
            'unsupported_response_type',
            'Only response_type=code is supported.',
          );
        }
        if (params.code_challenge_method !== 'S256') {
          throw new McpOAuthError('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
        }
        codeChallenge = requireString(params.code_challenge, 'code_challenge', 128);
        audience = requireString(params.resource, 'resource');
        if (audience !== `${baseUrl}/mcp`) {
          throw new McpOAuthError('invalid_request', 'The resource does not identify this MCP server.');
        }
        if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
          throw new McpOAuthError('invalid_request', 'The PKCE code challenge is invalid.');
        }
        scopes = normalizeOAuthScopeParameter(params.scope);
      } catch (error) {
        if (!(error instanceof McpOAuthError)) {
          throw error;
        }
        const redirect = new URL(redirectUri);
        redirect.searchParams.set('error', error.code);
        if (state !== null) {
          redirect.searchParams.set('state', state);
        }
        throw new McpOAuthAuthorizationRedirectError(
          error.code,
          error.message,
          redirect.toString(),
        );
      }
      const requestId = resolvedDependencies.randomToken(24);
      const record: AuthorizationRequestRecord = {
        requestId,
        clientId,
        clientName: metadata.client_name.trim(),
        redirectUri,
        redirectHost,
        codeChallenge,
        state,
        scopes,
        audience,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + AUTHORIZATION_REQUEST_LIFETIME_MS,
        status: 'pending',
      };
      await store.saveAuthorizationRequest(record);
      return {
        requestId,
        consentUrl: `${baseUrl}/mcp/authorize?request_id=${encodeURIComponent(requestId)}`,
      };
    },

    async getConsentDetails(requestId: string) {
      const request = await store.getAuthorizationRequest(
        requireOpaqueDocumentId(requestId, 'request_id'),
      );
      if (
        !request
        || request.status !== 'pending'
        || request.expiresAtMs <= resolvedDependencies.now()
      ) {
        throw new McpOAuthError('invalid_request', 'The authorization request is invalid or expired.');
      }
      return {
        requestId: request.requestId,
        clientName: request.clientName,
        clientIdHost: new URL(request.clientId).host,
        redirectUri: request.redirectUri,
        redirectHost: request.redirectHost,
        scopes: request.scopes,
        expiresAtMs: request.expiresAtMs,
        loopbackRedirect: ['localhost', '127.0.0.1', '[::1]'].includes(
          new URL(request.redirectUri).hostname,
        ),
      };
    },

    async decideAuthorization(input: {
      uid: string;
      requestId: string;
      approved: boolean;
      grantedScopes?: readonly string[];
    }) {
      const requestId = requireOpaqueDocumentId(input.requestId, 'request_id');
      const nowMs = resolvedDependencies.now();
      if (!input.approved) {
        const request = await store.denyAuthorization(requestId, nowMs);
        const redirect = new URL(request.redirectUri);
        redirect.searchParams.set('error', 'access_denied');
        if (request.state !== null) {
          redirect.searchParams.set('state', request.state);
        }
        return { redirectUri: redirect.toString() };
      }

      const request = await store.getAuthorizationRequest(requestId);
      if (!request || request.status !== 'pending' || request.expiresAtMs <= nowMs) {
        throw new McpOAuthError('invalid_request', 'The authorization request is invalid or expired.');
      }
      const grantedScopes = normalizeOAuthScopes(input.grantedScopes || request.scopes);
      if (grantedScopes.some(scope => !request.scopes.includes(scope))) {
        throw new McpOAuthError('invalid_scope', 'A scope was not included in the original request.');
      }
      const rawCode = resolvedDependencies.randomToken();
      const connectionId = buildMcpLogicalConnectionId(request.clientId);
      const codeRecord: AuthorizationCodeRecord = {
        uid: input.uid,
        connectionId,
        clientId: request.clientId,
        clientName: request.clientName,
        redirectUri: request.redirectUri,
        redirectHost: request.redirectHost,
        codeChallenge: request.codeChallenge,
        scopes: grantedScopes,
        audience: request.audience,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + AUTHORIZATION_CODE_LIFETIME_MS,
      };
      await store.approveAuthorization({
        uid: input.uid,
        requestId,
        grantedScopes,
        codeHash: hashOpaqueValue(rawCode),
        codeRecord,
        connection: {
          connectionId,
          clientId: request.clientId,
          clientName: request.clientName,
          redirectHost: request.redirectHost,
          scopes: grantedScopes,
          audience: request.audience,
          createdAtMs: nowMs,
          lastUsedAtMs: null,
          revokedAtMs: null,
          status: 'pending',
        },
        nowMs,
      });
      const redirect = new URL(request.redirectUri);
      redirect.searchParams.set('code', rawCode);
      if (request.state !== null) {
        redirect.searchParams.set('state', request.state);
      }
      return { redirectUri: redirect.toString() };
    },

    async exchangeAuthorizationCode(params: Record<string, unknown>, baseUrl: string) {
      rejectRepeatedOAuthParameters(params);
      const code = requireString(params.code, 'code');
      const clientId = requireString(params.client_id, 'client_id');
      const redirectUri = requireString(params.redirect_uri, 'redirect_uri');
      const verifier = requireString(params.code_verifier, 'code_verifier', 128);
      const audience = requireString(params.resource, 'resource');
      if (audience !== `${baseUrl}/mcp`) {
        throw new McpOAuthError('invalid_grant', 'The token audience is invalid.');
      }
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
        throw new McpOAuthError('invalid_grant', 'The PKCE verifier is invalid.');
      }
      const nowMs = resolvedDependencies.now();
      const rawAccessToken = resolvedDependencies.randomToken();
      const rawRefreshToken = resolvedDependencies.randomToken();
      const familyId = resolvedDependencies.randomToken(18);
      const placeholderScopes: McpOAuthScope[] = [];
      const codeRecord = await store.exchangeAuthorizationCode({
        codeHash: hashOpaqueValue(code),
        clientId,
        redirectUri,
        audience,
        codeChallenge: createPkceChallenge(verifier),
        accessTokenHash: hashOpaqueValue(rawAccessToken),
        accessTokenRecord: {
          uid: '',
          connectionId: '',
          clientId,
          grantId: familyId,
          scopes: placeholderScopes,
          audience,
          createdAtMs: nowMs,
          expiresAtMs: nowMs + ACCESS_TOKEN_LIFETIME_MS,
        },
        refreshTokenHash: hashOpaqueValue(rawRefreshToken),
        refreshTokenRecord: {
          uid: '',
          connectionId: '',
          clientId,
          scopes: placeholderScopes,
          audience,
          familyId,
          createdAtMs: nowMs,
          expiresAtMs: nowMs + REFRESH_TOKEN_LIFETIME_MS,
        },
        nowMs,
      });
      // The Firestore store fills token ownership from the code transactionally.
      // In-memory/custom stores return the authoritative code record used here.
      return {
        access_token: rawAccessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_LIFETIME_MS / 1000,
        refresh_token: rawRefreshToken,
        scope: codeRecord.scopes.join(' '),
      };
    },

    async exchangeRefreshToken(params: Record<string, unknown>, baseUrl: string) {
      rejectRepeatedOAuthParameters(params);
      const rawRefreshToken = requireString(params.refresh_token, 'refresh_token');
      const clientId = requireString(params.client_id, 'client_id');
      const audience = requireString(params.resource, 'resource');
      if (audience !== `${baseUrl}/mcp`) {
        throw new McpOAuthError('invalid_grant', 'The token audience is invalid.');
      }
      const requestedScopes = params.scope === undefined || params.scope === null || params.scope === ''
        ? null
        : normalizeOAuthScopeParameter(params.scope);
      const nowMs = resolvedDependencies.now();
      const nextRawAccessToken = resolvedDependencies.randomToken();
      const nextRawRefreshToken = resolvedDependencies.randomToken();
      const placeholderScopes = requestedScopes || [];
      const refresh = await store.exchangeRefreshToken({
        refreshTokenHash: hashOpaqueValue(rawRefreshToken),
        clientId,
        audience,
        requestedScopes,
        nextAccessTokenHash: hashOpaqueValue(nextRawAccessToken),
        nextAccessTokenRecord: {
          uid: '',
          connectionId: '',
          clientId,
          scopes: placeholderScopes,
          audience,
          createdAtMs: nowMs,
          expiresAtMs: nowMs + ACCESS_TOKEN_LIFETIME_MS,
        },
        nextRefreshTokenHash: hashOpaqueValue(nextRawRefreshToken),
        nextRefreshTokenRecord: {
          uid: '',
          connectionId: '',
          clientId,
          scopes: placeholderScopes,
          audience,
          familyId: '',
          createdAtMs: nowMs,
          expiresAtMs: nowMs + REFRESH_TOKEN_LIFETIME_MS,
        },
        nowMs,
      });
      const scopes = requestedScopes || refresh.scopes;
      return {
        access_token: nextRawAccessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_LIFETIME_MS / 1000,
        refresh_token: nextRawRefreshToken,
        scope: scopes.join(' '),
      };
    },

    async revokeToken(
      params: Record<string, unknown>,
      context?: McpRevocationContext,
    ): Promise<void> {
      rejectRepeatedOAuthParameters(params);
      const tokenHash = hashOpaqueValue(requireString(params.token, 'token', 4096));
      const clientId = requirePublicClientId(params.client_id);
      const tokenTypeHint = readMcpTokenTypeHint(params.token_type_hint);
      const nowMs = resolvedDependencies.now();
      await store.consumeRevocationRateLimit({
        clientId,
        requesterKey: normalizeOAuthRequesterKey(context?.requesterKey),
        nowMs,
      });
      await store.revokeConnection({
        kind: 'token',
        tokenHash,
        tokenTypeHint,
        clientId,
      }, nowMs);
    },

    async authenticateBearer(rawToken: string, audience: string) {
      const tokenHash = hashOpaqueValue(requireString(rawToken, 'access_token'));
      const token = await store.getAccessToken(tokenHash);
      const nowMs = resolvedDependencies.now();
      if (!token || token.expiresAtMs <= nowMs || token.audience !== audience) {
        throw new McpOAuthError('invalid_grant', 'The access token is invalid or expired.', 401);
      }
      if (!hasValidMcpScopeDependencies(token.scopes)) {
        throw new McpOAuthError(
          'invalid_grant',
          'The access token contains an invalid dependent scope.',
          401,
        );
      }
      const connection = await store.getConnection(token.uid, token.connectionId);
      if (!isActiveMcpConnection(connection) || connection.clientId !== token.clientId) {
        throw new McpOAuthError('invalid_grant', 'The MCP connection is no longer active.', 401);
      }
      const logicalConnectionId = buildMcpLogicalConnectionId(token.clientId);
      if (token.connectionId !== logicalConnectionId) {
        const logicalConnection = await store.getConnection(
          token.uid,
          logicalConnectionId,
        );
        if (
          logicalConnection
          && logicalConnection.clientId !== token.clientId
        ) {
          throw new McpOAuthError(
            'invalid_grant',
            'The MCP client binding is invalid.',
            401,
          );
        }
        if (isSupersededLegacyConnection(token.connectionId, logicalConnection)) {
          throw new McpOAuthError(
            'invalid_grant',
            'The MCP connection was superseded.',
            401,
          );
        }
      }
      if (!isCurrentMcpGrant(token.connectionId, connection, token.grantId)) {
        throw new McpOAuthError(
          'invalid_grant',
          'The MCP authorization grant was superseded.',
          401,
        );
      }
      if (token.scopes.some(scope => !connection.scopes.includes(scope))) {
        throw new McpOAuthError(
          'invalid_grant',
          'The MCP connection no longer authorizes this access token.',
          401,
        );
      }
      await store.recordAuthorizedRequest(token, nowMs);
      return {
        uid: token.uid,
        clientId: token.clientId,
        connectionId: token.connectionId,
        scopes: token.scopes,
      };
    },

    async listConnections(uid: string) {
      const connections = await store.listConnections(uid);
      const supersedingClientIds = new Set(
        connections
          .filter(connection => (
            connection.supersedesLegacy === true
            && connection.connectionId === buildMcpLogicalConnectionId(connection.clientId)
          ))
          .map(connection => connection.clientId),
      );
      return connections.filter(connection => (
        isActiveMcpConnection(connection)
        && (
          !supersedingClientIds.has(connection.clientId)
          || connection.connectionId === buildMcpLogicalConnectionId(connection.clientId)
        )
      )).map(toMcpConnectionSummary);
    },

    revokeConnection(uid: string, connectionId: string) {
      return store.revokeConnection(
        {
          kind: 'owner',
          uid,
          connectionId: requireOpaqueDocumentId(connectionId, 'connection_id'),
        },
        resolvedDependencies.now(),
      );
    },
  };
}

interface McpOAuthCleanupPageResult {
  deletedCount: number;
  hasMore: boolean;
}

export class McpOAuthCleanupIncompleteError extends Error {
  constructor(readonly deletedCount: number) {
    super(
      `MCP OAuth cleanup reached its ${MCP_OAUTH_CLEANUP_MAX_DOCUMENTS}-document budget and requires a retry.`,
    );
    this.name = 'McpOAuthCleanupIncompleteError';
  }
}

async function cleanupMcpOAuthQuery(
  db: admin.firestore.Firestore,
  baseQuery: admin.firestore.Query,
  maxDocuments: number,
): Promise<McpOAuthCleanupPageResult> {
  let deletedCount = 0;

  while (deletedCount < maxDocuments) {
    const pageSize = Math.min(
      MCP_OAUTH_CLEANUP_PAGE_SIZE,
      maxDocuments - deletedCount,
    );
    const snapshot = await baseQuery.limit(pageSize + 1).get();
    if (snapshot.empty) {
      return { deletedCount, hasMore: false };
    }

    const docsToDelete = snapshot.docs.slice(0, pageSize);
    for (
      let index = 0;
      index < docsToDelete.length;
      index += MCP_OAUTH_CLEANUP_DELETE_CONCURRENCY
    ) {
      const results = await Promise.allSettled(
        docsToDelete
          .slice(index, index + MCP_OAUTH_CLEANUP_DELETE_CONCURRENCY)
          .map(doc => db.recursiveDelete(doc.ref)),
      );
      const failedDelete = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failedDelete) {
        throw failedDelete.reason;
      }
    }
    deletedCount += docsToDelete.length;

    if (snapshot.docs.length <= pageSize) {
      return { deletedCount, hasMore: false };
    }
  }

  return { deletedCount, hasMore: true };
}

export async function cleanupMcpOAuthStateForUser(uid: string): Promise<void> {
  const db = admin.firestore();
  const queries: admin.firestore.Query[] = [
    db.collection(MCP_OAUTH_COLLECTIONS.authorizationRequests).where('uid', '==', uid),
    db.collection(MCP_OAUTH_COLLECTIONS.authorizationCodes).where('uid', '==', uid),
    db.collection(MCP_OAUTH_COLLECTIONS.accessTokens).where('uid', '==', uid),
    db.collection(MCP_OAUTH_COLLECTIONS.refreshTokens).where('uid', '==', uid),
    db.collection(MCP_OAUTH_COLLECTIONS.rateLimits).where('uid', '==', uid),
    db.collection('users').doc(uid).collection(MCP_OAUTH_COLLECTIONS.userConnections),
  ];
  let deletedCount = 0;

  for (let index = 0; index < queries.length; index += 1) {
    const remainingBudget = MCP_OAUTH_CLEANUP_MAX_DOCUMENTS - deletedCount;
    if (remainingBudget === 0) {
      const remainingSnapshot = await queries[index].limit(1).get();
      if (!remainingSnapshot.empty) {
        throw new McpOAuthCleanupIncompleteError(deletedCount);
      }
      continue;
    }
    const result = await cleanupMcpOAuthQuery(db, queries[index], remainingBudget);
    deletedCount += result.deletedCount;
    if (result.hasMore) {
      throw new McpOAuthCleanupIncompleteError(deletedCount);
    }
  }
}
