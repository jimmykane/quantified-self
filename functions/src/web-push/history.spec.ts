import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ServiceNames } from '@sports-alliance/sports-lib';
import webpush from 'web-push';
import { createHistoryRun } from '../connection-history/model';
import { SECRET_PARAMS } from '../secrets';
import { sendHistoryImportNotification } from './history';
import { sendHistoryCompletion } from './history-service';
import { historyPushConfiguration } from './history-consent';
const mocks = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }));
vi.mock('firebase-functions/logger', () => ({ info: mocks.log, error: mocks.log }));
vi.mock('./history-consent', () => ({ historyPushConfiguration: vi.fn() }));
vi.mock('./history-service', async original => ({ ...(await original<object>()), sendHistoryCompletion: vi.fn() }));
vi.mock('web-push', async original => ({ default: { ...(await original<{ default: typeof webpush }>()).default, sendNotification: vi.fn().mockResolvedValue({}) } }));
function event() {
  const run = createHistoryRun('owner', ServiceNames.SuuntoApp, { requested: true, rangePreset: '30_days',
    runId: '00000000-0000-4000-8000-000000000003', providerUserId: 'account',
    tokenPath: 'tokens/owner/tokens/account', rootPath: 'tokens/owner', credentialGeneration: 'credential' }, 'connection', Date.now());
  Object.assign(run, { rangePreset: 'custom', processed: true,
    notification: { installationId: '00000000-0000-4000-8000-000000000001', generation: '00000000-0000-4000-8000-000000000002', origin: 'https://quantified-self.io' } });
  run.steps = run.steps.filter(step => step.id === 'activities');
  Object.assign(run.steps[0], { done: true, status: 'processed' });
  return { params: { runId: run.id }, data: { before: { data: () => ({ ...run, processed: false }) }, after: { data: () => run } } };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(sendHistoryCompletion).mockResolvedValue(); });
afterEach(() => { vi.restoreAllMocks(); });
describe('history push event adapter', () => {
  it.each(['checkpoint', 'create', 'delete', 'already terminal', 'unconsented', 'wrong id', 'Garmin'])('ignores %s without configuration or secret access', async kind => {
    const input = event(); const run = input.data.after.data();
    if (kind === 'checkpoint') run.processed = false;
    if (kind === 'create') input.data.before.data = () => undefined as never;
    if (kind === 'delete') input.data.after.data = () => undefined as never;
    if (kind === 'already terminal') input.data.before.data = () => run;
    if (kind === 'unconsented') delete run.notification;
    if (kind === 'wrong id') input.params.runId = 'wrong';
    if (kind === 'Garmin') run.serviceName = ServiceNames.GarminAPI;
    const secret = vi.spyOn(SECRET_PARAMS.WEB_PUSH_VAPID_KEYPAIR, 'value');
    await sendHistoryImportNotification.run(input as never);
    expect(sendHistoryCompletion).not.toHaveBeenCalled(); expect(historyPushConfiguration).not.toHaveBeenCalled(); expect(secret).not.toHaveBeenCalled();
  });
  it.each([
    { endpoint: 'https://web.push.apple.com/synthetic', extraOptions: {} },
    { endpoint: 'https://test.notify.windows.com/synthetic', extraOptions: { headers: { 'X-WNS-Type': 'wns/raw', 'X-WNS-TTL': '3600' } } },
  ])('uses bounded encrypted transport for $endpoint', async ({ endpoint, extraOptions }) => {
    const pair = webpush.generateVAPIDKeys();
    vi.spyOn(SECRET_PARAMS.WEB_PUSH_VAPID_KEYPAIR, 'value').mockReturnValue(JSON.stringify(pair));
    vi.mocked(historyPushConfiguration).mockResolvedValue({ enabled: true, publicKey: pair.publicKey });
    const input = event(); await sendHistoryImportNotification.run(input as never);
    const [id, run, deps] = vi.mocked(sendHistoryCompletion).mock.calls[0];
    expect(id).toBe(input.params.runId); expect(run).toBe(input.data.after.data());
    await deps.configuration(); await deps.send({ endpoint } as never, 'fixed-payload');
    expect(webpush.sendNotification).toHaveBeenCalledWith({ endpoint }, 'fixed-payload', {
      vapidDetails: { subject: 'mailto:support@quantified-self.io', ...pair }, TTL: 3600, timeout: 5000,
      urgency: 'low', topic: 'qs-history-import', ...extraOptions,
    });
    deps.outcome('accepted'); expect(mocks.log).toHaveBeenCalledWith('[HistoryImportPush]', { telemetryVersion: 1, outcome: 'accepted' });
  });
  it('does not read the signing key while disabled and rejects mismatched key pairs before sending', async () => {
    const secret = vi.spyOn(SECRET_PARAMS.WEB_PUSH_VAPID_KEYPAIR, 'value');
    await sendHistoryImportNotification.run(event() as never);
    const deps = vi.mocked(sendHistoryCompletion).mock.calls[0][2];
    vi.mocked(historyPushConfiguration).mockResolvedValue({ enabled: false, publicKey: '' });
    await expect(deps.configuration()).resolves.toEqual({ enabled: false, publicKey: '' }); expect(secret).not.toHaveBeenCalled();
    secret.mockReturnValue(JSON.stringify(webpush.generateVAPIDKeys()));
    vi.mocked(historyPushConfiguration).mockResolvedValue({ enabled: true, publicKey: 'different' });
    await expect(deps.configuration()).rejects.toThrow('Notification key mismatch'); expect(webpush.sendNotification).not.toHaveBeenCalled();
  });
  it('retries preparation errors without exposing private errors', async () => {
    vi.mocked(sendHistoryCompletion).mockRejectedValue(new Error('private-canary'));
    await expect(sendHistoryImportNotification.run(event() as never)).rejects.toThrow('History import notification preparation or bookkeeping failed.');
    expect(mocks.log).toHaveBeenCalledWith('[HistoryImportPush]', { telemetryVersion: 1, outcome: 'failed' });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('private-canary');
  });
});
