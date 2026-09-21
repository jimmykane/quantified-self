import { GARMIN_HEALTH_SUMMARY_TYPES, type GarminHealthSummaryType } from '../garmin/health-summary-types';
import { createHash } from 'node:crypto';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { connectionHistoryRange, historyCapabilities, type HistoryCapability, type ConnectionHistoryStepStatus, type ConnectionHistoryStatusProjection } from '../../../shared/connection-history';

export const CONNECTION_HISTORY_COLLECTION = 'connectionHistoryImports';
export const OAUTH_HISTORY_FIELD = 'oauthImportRecentHistory';
export interface HistoryStep extends ConnectionHistoryStepStatus {
  capability: HistoryCapability;
  nextStartMs: number;
  page: number;
  windowDays?: number;
  retryCount: number;
  done: boolean;
  childPaths: string[];
}
export interface ConnectionHistoryRun {
  id: string;
  userID: string;
  serviceName: ServiceNames;
  providerUserId: string;
  tokenPath: string;
  rootPath: string;
  credentialGeneration: string;
  connectionGeneration: string;
  startMs: number;
  endMs: number;
  dateCreated: number;
  updatedAtMs: number;
  nextAttemptAt: number;
  processed: boolean;
  revision: number;
  failed?: boolean;
  garminHealthSummaryTypes?: readonly GarminHealthSummaryType[];
  steps: HistoryStep[];
  lastOperation?: { key: string; result: { count: number; nextStartMs: number; nextPage: number; childPaths: string[] } };
  leaseOwner?: string;
  leaseExpiresAt?: number;
}
export interface HistoryConnectionContext {
  requested: boolean;
  flowGeneration: string;
  tokenPath: string;
  rootPath: string;
  providerUserId: string;
  credentialGeneration: string;
}
// This is a document identity hash, not a password verifier. flowGeneration is
// a server-generated randomUUID (beginOAuthFlowIfUserActive), never a password,
// access token, OAuth state, or PKCE verifier. No credential is hashed here.
export function historyRunId(userID: string, serviceName: ServiceNames, flowGeneration: string): string {
  return createHash('sha256').update(JSON.stringify([userID, serviceName, flowGeneration])).digest('hex');
}
export function createHistoryRun(userID: string, serviceName: ServiceNames, context: HistoryConnectionContext, connectionGeneration: string, nowMs: number): ConnectionHistoryRun {
  const range = connectionHistoryRange(nowMs);
  return {
    id: historyRunId(userID, serviceName, context.flowGeneration), userID, serviceName,
    providerUserId: context.providerUserId, tokenPath: context.tokenPath, rootPath: context.rootPath,
    credentialGeneration: context.credentialGeneration, connectionGeneration, ...range,
    dateCreated: nowMs, updatedAtMs: nowMs, nextAttemptAt: nowMs, processed: false, revision: 0,
    ...(serviceName === ServiceNames.GarminAPI ? { garminHealthSummaryTypes: [...GARMIN_HEALTH_SUMMARY_TYPES] } : {}),
    steps: historyCapabilities(serviceName).map(capability => ({
      id: capability.id, resources: [...capability.resources], capability: { ...capability, resources: [...capability.resources] },
      status: 'queued', count: 0, nextStartMs: range.startMs, page: 1, retryCount: 0, done: false, childPaths: [],
    })),
  };
}
export function historyProjection(run: ConnectionHistoryRun): ConnectionHistoryStatusProjection {
  return {
    runId: run.id, startMs: run.startMs, endMs: run.endMs, updatedAtMs: run.updatedAtMs,
    active: !run.processed, canRetry: run.processed && run.steps.some(step => step.status === 'failed'),
    steps: run.steps.map(step => ({ id: step.id, resources: step.resources, status: step.status, count: step.count,
      ...(step.message ? { message: step.message } : {}), ...(step.nextAllowedAtMs ? { nextAllowedAtMs: step.nextAllowedAtMs } : {}) })),
  };
}
