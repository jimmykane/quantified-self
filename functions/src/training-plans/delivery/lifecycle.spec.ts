import { createHash } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  onDocumentWritten: vi.fn((options: unknown, handler: unknown) => ({ options, handler })),
}));

vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: mocks.onDocumentWritten }));
vi.mock('../../shared/user-deletion-guard', () => ({ getUserDeletionGuardStateInTransaction: vi.fn() }));
vi.mock('./marker', () => ({ stageTrainingDeliveryReconciliation: vi.fn() }));
vi.mock('./runtime', () => ({
  DELIVERY_SERVICES: { suunto: { name: 'suuntoApp' } },
  productionDeliveryRuntime: vi.fn(),
}));
vi.mock('./contracts', () => ({ DELIVERY_STATE: 'trainingDeliveryState' }));

import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { stageTrainingDeliveryReconciliation } from './marker';
import { productionDeliveryRuntime } from './runtime';
import { onTrainingDeliveryConnectionChanged, onTrainingDeliveryEntitlementChanged, onTrainingDeliveryGuideSettingsChanged, onTrainingDeliveryOwnerUnitsChanged } from './lifecycle';
import { defaultSuuntoSwimmingGuideSettings } from '../../../../shared/suunto-swimming-guide-settings';
import { WeightUnits } from '@sports-alliance/sports-lib';

type TestEvent = { id: string; params: { uid: string; service: string }; data?: unknown };
type TestTrigger = { options: Record<string, unknown>; handler: (event: TestEvent) => Promise<void> };
const connection = onTrainingDeliveryConnectionChanged as unknown as TestTrigger;
const entitlement = onTrainingDeliveryEntitlementChanged as unknown as TestTrigger;
const ownerUnits = onTrainingDeliveryOwnerUnitsChanged as unknown as TestTrigger;
const guideSettings = onTrainingDeliveryGuideSettingsChanged as unknown as TestTrigger;
const event: TestEvent = { id: 'private-cloud-event', params: { uid: 'private-user-uid', service: 'suuntoApp' },
  data: { private: 'private-connection-payload' } };
const eventHash = createHash('sha256').update(event.id).digest('hex');
const settingsEvent = (before: unknown, after: unknown): TestEvent => ({ ...event, data: {
  before: { exists: before !== undefined, data: () => before },
  after: { exists: after !== undefined, data: () => after },
} });
const changedSettings = { suuntoSwimmingGuide: { ...defaultSuuntoSwimmingGuideSettings(),
  restFields: ['interval', 'nextPlannedDistance', 'previousLapPace'] } };
const stateRef = { path: 'private-document-path' };
const stateCollection = { doc: vi.fn(() => stateRef) };
const userRef = { collection: vi.fn(() => stateCollection) };
const users = { doc: vi.fn(() => userRef) };
const tx = { get: vi.fn() };
const db = { collection: vi.fn(() => users), runTransaction: vi.fn() };
let nowMs: number;

function logFields() {
  return [logger.debug, logger.info, logger.warn].flatMap(log => vi.mocked(log).mock.calls.map(call => call[1]));
}

describe('Training delivery lifecycle triggers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const log of [logger.debug, logger.info, logger.warn]) vi.mocked(log).mockReset();
    vi.mocked(stageTrainingDeliveryReconciliation).mockReset();
    nowMs = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    vi.mocked(getUserDeletionGuardStateInTransaction).mockResolvedValue({ userExists: true,
      deletionInProgress: false, shouldSkip: false });
    tx.get.mockResolvedValue({ data: () => ({ revision: 1 }) });
    db.runTransaction.mockImplementation(async callback => callback(tx));
    vi.mocked(productionDeliveryRuntime).mockReturnValue({ db } as unknown as ReturnType<typeof productionDeliveryRuntime>);
  });
  afterEach(() => vi.restoreAllMocks());

  it('allocates 512 MiB to the connection and entitlement reconciliation triggers', () => {
    expect(connection.options).toEqual({
      document: 'users/{uid}/meta/{service}',
      region: 'europe-west2',
      memory: '512MiB',
      retry: true,
    });
    expect(entitlement.options).toEqual({
      document: 'users/{uid}/system/status',
      region: 'europe-west2',
      memory: '512MiB',
      retry: true,
    });
    expect(guideSettings.options).toEqual({ document: 'users/{uid}/config/settings',
      region: 'europe-west2', memory: '512MiB', retry: true });
  });

  it('wakes same-identity reconciliation on changed Guide preferences, including their first save', async () => {
    await guideSettings.handler(settingsEvent(undefined, changedSettings));
    await guideSettings.handler(settingsEvent(changedSettings, { suuntoSwimmingGuide: defaultSuuntoSwimmingGuideSettings() }));
    expect(stageTrainingDeliveryReconciliation).toHaveBeenCalledTimes(2);
    expect(stageTrainingDeliveryReconciliation).toHaveBeenLastCalledWith(tx, db, event.params.uid);
    expect(logger.info).toHaveBeenLastCalledWith('[TrainingDeliveryLifecycle]', expect.objectContaining({
      event: 'completed', trigger: 'guide-settings', eventHash, outcome: 'reconciliation_staged',
    }));
    expect(JSON.stringify(logFields())).not.toMatch(/private-|suuntoSwimmingGuide|nextPlannedDistance/);
  });

  it('ignores unrelated, equivalent/default and missing settings events', async () => {
    for (const input of [{ ...event, data: undefined },
      settingsEvent({}, { suuntoSwimmingGuide: defaultSuuntoSwimmingGuideSettings(), theme: 'dark' }),
      settingsEvent(changedSettings, { ...changedSettings, theme: 'dark' }), settingsEvent(undefined, {})]) {
      await guideSettings.handler(input);
    }
    expect(productionDeliveryRuntime).not.toHaveBeenCalled();
    expect(logFields()).toEqual([]);
  });

  it('reconciles the effective default after deleting saved Guide settings', async () => {
    await guideSettings.handler(settingsEvent(changedSettings, undefined));
    expect(stageTrainingDeliveryReconciliation).toHaveBeenCalledOnce();
  });

  it('wakes for effective owner unit changes without scanning on other profile writes', async () => {
    expect(ownerUnits.options).toEqual({ document: 'users/{uid}', region: 'europe-west2', memory: '512MiB', retry: true });
    await ownerUnits.handler(settingsEvent({}, { displayName: 'Changed' }));
    await ownerUnits.handler(settingsEvent({}, undefined));
    expect(productionDeliveryRuntime).not.toHaveBeenCalled();
    await ownerUnits.handler(settingsEvent({}, { settings: { unitSettings: { weightUnits: WeightUnits.Pounds } } }));
    await ownerUnits.handler(settingsEvent({ settings: { unitSettings: { weightUnits: WeightUnits.Pounds } } }, {}));
    expect(stageTrainingDeliveryReconciliation).toHaveBeenCalledTimes(2);
  });

  it('keeps settings wake-ups behind account deletion and existing delivery-state guards', async () => {
    const input = settingsEvent({}, changedSettings);
    vi.mocked(getUserDeletionGuardStateInTransaction).mockResolvedValueOnce({ userExists: false,
      deletionInProgress: false, shouldSkip: true });
    await guideSettings.handler(input);
    expect(tx.get).not.toHaveBeenCalled();
    tx.get.mockResolvedValueOnce({ data: () => undefined });
    await guideSettings.handler(input);
    expect(stageTrainingDeliveryReconciliation).not.toHaveBeenCalled();
  });

  it.each([['connection', connection], ['entitlement', entitlement]] as const)(
    'correlates %s events without logging private event or account data', async (trigger, fn) => {
      await fn.handler(event);
      await fn.handler(event); // Redelivery retains the event hash.
      expect(getUserDeletionGuardStateInTransaction).toHaveBeenCalledWith(db, tx, event.params.uid);
      expect(db.collection).toHaveBeenCalledWith('users');
      expect(users.doc).toHaveBeenCalledWith(event.params.uid);
      expect(userRef.collection).toHaveBeenCalledWith('trainingDeliveryState');
      expect(stateCollection.doc).toHaveBeenCalledWith('current');
      expect(tx.get).toHaveBeenCalledWith(stateRef);
      expect(stageTrainingDeliveryReconciliation).toHaveBeenCalledTimes(2);
      expect(stageTrainingDeliveryReconciliation).toHaveBeenCalledWith(tx, db, event.params.uid);
      expect(logger.info).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenLastCalledWith('[TrainingDeliveryLifecycle]', expect.objectContaining({
        event: 'completed', trigger, eventHash, stage: 'commit', attempt: 1, outcome: 'reconciliation_staged',
      }));
      const serialized = JSON.stringify(logFields());
      for (const privateValue of [event.id, event.params.uid, stateRef.path, 'private-connection-payload']) {
        expect(serialized).not.toContain(privateValue);
      }
      expect(logger.warn).not.toHaveBeenCalled();
    });

  it('ignores unsupported metadata documents without creating a runtime or logs', async () => {
    await connection.handler({ ...event, params: { ...event.params, service: 'unrelated' } });
    expect(productionDeliveryRuntime).not.toHaveBeenCalled();
    expect(logFields()).toEqual([]);
  });

  it('ignores an 830-upload burst and history progress without reading Firestore', async () => {
    const authority = { connectionState: 'connected', connectionStateGeneration: 3, connectionAccounts: ['one'] };
    for (let count = 137; count < 967; count++) {
      await connection.handler(settingsEvent({ ...authority, uploadedActivitiesCount: count,
        connectionHistoryImport: { processed: count } }, { ...authority, uploadedActivitiesCount: count + 1,
        connectionHistoryImport: { processed: count + 1 } }));
    }
    expect(productionDeliveryRuntime).not.toHaveBeenCalled();
    expect(stageTrainingDeliveryReconciliation).not.toHaveBeenCalled();
  });

  it.each(['connectionState', 'connectionStateGeneration', 'connectionAccountsRevisionKey', 'permissions', 'futureAuthority'])(
    'still wakes reconciliation when %s changes alongside an upload counter', async field => {
      await connection.handler(settingsEvent({ [field]: 'before', uploadedActivitiesCount: 1 },
        { [field]: 'after', uploadedActivitiesCount: 2 }));
      expect(stageTrainingDeliveryReconciliation).toHaveBeenCalledOnce();
    });

  it('keeps connection creation and deletion as wake-ups', async () => {
    await connection.handler(settingsEvent(undefined, { connectionState: 'connected' }));
    await connection.handler(settingsEvent({ connectionState: 'connected' }, undefined));
    expect(stageTrainingDeliveryReconciliation).toHaveBeenCalledTimes(2);
  });

  it('keeps the deletion guard skip without reading delivery state or staging work', async () => {
    vi.mocked(getUserDeletionGuardStateInTransaction).mockResolvedValue({ userExists: false,
      deletionInProgress: false, shouldSkip: true });
    await connection.handler(event);
    expect(tx.get).not.toHaveBeenCalled();
    expect(stageTrainingDeliveryReconciliation).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('[TrainingDeliveryLifecycle]', expect.objectContaining({
      event: 'completed', outcome: 'deletion_guard_skipped',
    }));
  });

  it('keeps the missing-state skip without staging reconciliation', async () => {
    tx.get.mockResolvedValue({ data: () => undefined });
    await connection.handler(event);
    expect(stageTrainingDeliveryReconciliation).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('[TrainingDeliveryLifecycle]', expect.objectContaining({
      event: 'completed', outcome: 'no_delivery_state',
    }));
  });

  it('emits the read stage before waiting and reports elapsed time only after commit', async () => {
    let resolveRead!: (value: unknown) => void;
    let resolveCommit!: () => void;
    const read = new Promise(resolve => { resolveRead = resolve; });
    const commit = new Promise<void>(resolve => { resolveCommit = resolve; });
    tx.get.mockImplementation(() => {
      expect(logger.debug).toHaveBeenLastCalledWith('[TrainingDeliveryLifecycle]', expect.objectContaining({
        event: 'stage_started', stage: 'delivery_state', attempt: 1,
      }));
      return read;
    });
    db.runTransaction.mockImplementation(async callback => {
      const outcome = await callback(tx);
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenLastCalledWith('[TrainingDeliveryLifecycle]', expect.objectContaining({
        stage: 'commit', previousStage: 'delivery_state', previousStageMs: 40,
      }));
      await commit;
      return outcome;
    });
    const pending = connection.handler(event);
    await vi.waitFor(() => expect(tx.get).toHaveBeenCalled());
    nowMs += 40;
    resolveRead({ data: () => ({ revision: 1 }) });
    await vi.waitFor(() => expect(stageTrainingDeliveryReconciliation).toHaveBeenCalled());
    expect(logger.info).not.toHaveBeenCalled();
    nowMs += 20;
    resolveCommit();
    await pending;
    expect(logger.info).toHaveBeenCalledWith('[TrainingDeliveryLifecycle]', expect.objectContaining({
      event: 'completed', elapsedMs: 60, stageElapsedMs: 20,
    }));
  });

  it('counts transaction attempts and reports only the final committed outcome', async () => {
    db.runTransaction.mockImplementation(async callback => {
      await callback(tx); // Simulate an aborted first attempt, then changed current state.
      tx.get.mockResolvedValue({ data: () => ({ revision: 0 }) });
      return callback(tx);
    });
    await connection.handler(event);
    expect(getUserDeletionGuardStateInTransaction).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDeliveryLifecycle]', expect.objectContaining({
      event: 'completed', attempt: 2, outcome: 'no_delivery_state',
    }));
  });

  it.each([[4, 'deadline-exceeded'], ['unavailable', 'unavailable'], ['private-error-code', 'unknown']])(
    'bounds failure code %s and preserves the original retryable error', async (code, persistenceCode) => {
      const error = Object.assign(new Error('private-error-message'), { code, details: 'private-error-details' });
      tx.get.mockRejectedValueOnce(error);
      await expect(connection.handler(event)).rejects.toBe(error);
      expect(logger.warn).toHaveBeenCalledWith('[TrainingDeliveryLifecycle]', expect.objectContaining({
        event: 'failed', stage: 'delivery_state', persistenceCode,
      }));
      expect(logger.info).not.toHaveBeenCalled();
      expect(stageTrainingDeliveryReconciliation).not.toHaveBeenCalled();
      expect(JSON.stringify(logFields())).not.toMatch(/private-error/);
    });

  it('does not report completion if commit fails', async () => {
    const error = Object.assign(new Error('private-commit-failure'), { code: 10 });
    db.runTransaction.mockImplementation(async callback => { await callback(tx); throw error; });
    await expect(connection.handler(event)).rejects.toBe(error);
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('[TrainingDeliveryLifecycle]', expect.objectContaining({
      event: 'failed', stage: 'commit', persistenceCode: 'aborted',
    }));
  });

  it('does not let logging failures change transaction behavior', async () => {
    const failLog = () => { throw new Error('logging unavailable'); };
    vi.mocked(logger.debug).mockImplementation(failLog);
    vi.mocked(logger.info).mockImplementation(failLog);
    vi.mocked(logger.warn).mockImplementation(failLog);
    await expect(connection.handler(event)).resolves.toBeUndefined();
    expect(stageTrainingDeliveryReconciliation).toHaveBeenCalledOnce();
    const error = new Error('original-failure');
    tx.get.mockRejectedValueOnce(error);
    await expect(connection.handler(event)).rejects.toBe(error);
  });
});
