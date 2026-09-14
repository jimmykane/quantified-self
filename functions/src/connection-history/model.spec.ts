import { describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ServiceNames } from '@sports-alliance/sports-lib';
import { connectionHistoryRange, historyCapabilities, parseImportRecentHistory } from '../../../shared/connection-history';
import { isConnectionHistoryAdmissionEnabled } from './admission';
import { CONNECTION_HISTORY_CAPABILITIES } from '../../../shared/connection-history';
import { createHistoryRun, historyProjection, historyRunId } from './model';

describe('connection history contract', () => {
  it('has a server admission switch and retains manual entrypoints', () => {
    const previous = process.env.CONNECTION_HISTORY_IMPORT_ENABLED;
    try { process.env.CONNECTION_HISTORY_IMPORT_ENABLED = 'false'; expect(isConnectionHistoryAdmissionEnabled()).toBe(false);
      delete process.env.CONNECTION_HISTORY_IMPORT_ENABLED; expect(isConnectionHistoryAdmissionEnabled()).toBe(true);
    } finally { if (previous === undefined) delete process.env.CONNECTION_HISTORY_IMPORT_ENABLED; else process.env.CONNECTION_HISTORY_IMPORT_ENABLED = previous; }
  });
  it('includes newly registered capabilities only in future runs, with no OAuth or UI orchestration change', () => {
    const context = { requested: true, flowGeneration: 'flow', tokenPath: 'private/token', rootPath: 'private/root', providerUserId: 'account', credentialGeneration: 'credential' };
    const existing = createHistoryRun('owner', ServiceNames.WahooAPI, context, 'connection', Date.now());
    const capabilities = CONNECTION_HISTORY_CAPABILITIES[ServiceNames.WahooAPI] as unknown as Array<any>;
    try { capabilities.push({ id: 'fixture', version: 1, resources: ['health'], cooldownGroup: 'sleep', completion: 'queued' });
      const future = createHistoryRun('owner', ServiceNames.WahooAPI, context, 'connection2', Date.now());
      expect(future.steps.some(step => step.id === 'fixture')).toBe(true); expect(existing.steps.some(step => step.id === 'fixture')).toBe(false);
    } finally { capabilities.pop(); }
  });
  it.each(['2026-01-01T12:00:00Z', '2024-03-01T12:00:00Z', '2026-03-30T00:00:00Z', '2026-09-14T00:00:00Z'])('requests exactly 30 UTC dates at %s', iso => {
    const now = Date.parse(iso); const range = connectionHistoryRange(now);
    expect(Math.floor(now / 86400000) - range.startMs / 86400000).toBe(29);
    expect(range.endMs).toBe(now);
  });
  it('accepts explicit consent only and rejects malformed choices', () => {
    expect(parseImportRecentHistory(undefined)).toBe(false);
    expect(parseImportRecentHistory(false)).toBe(false);
    expect(parseImportRecentHistory(true)).toBe(true);
    for (const value of ['true', 1, null, {}]) expect(() => parseImportRecentHistory(value)).toThrow();
  });
  it('covers every current OAuth provider with the supported domains', () => {
    for (const service of [ServiceNames.GarminAPI, ServiceNames.SuuntoApp, ServiceNames.COROSAPI]) {
      expect(new Set(historyCapabilities(service).flatMap(x => x.resources))).toEqual(new Set(['activities', 'sleep', 'health']));
    }
    expect(historyCapabilities(ServiceNames.WahooAPI).flatMap(x => x.resources)).toEqual(['activities']);
  });
  it('snapshots capabilities and hides account, credential, cursor and lease fields', () => {
    const run = createHistoryRun('owner', ServiceNames.COROSAPI, { requested: true, flowGeneration: 'flow', tokenPath: 'private/token', rootPath: 'private/root', providerUserId: 'private-id', credentialGeneration: 'private-gen' }, 'connection', Date.parse('2026-09-14T12:00:00Z'));
    expect(run.id).toBe(historyRunId('owner', ServiceNames.COROSAPI, 'flow'));
    expect(run.id).not.toBe(historyRunId('owner', ServiceNames.COROSAPI, 'other'));
    expect(run.steps[0].capability).not.toBe(historyCapabilities(ServiceNames.COROSAPI)[0]);
    const projection = historyProjection(run);
    expect(JSON.stringify(projection)).not.toMatch(/private|credential|lease|nextStart|connectionGeneration/);
    expect(projection.active).toBe(true);
    run.processed = true; run.steps[0].status = 'failed';
    expect(historyProjection(run).canRetry).toBe(true);
  });
});
