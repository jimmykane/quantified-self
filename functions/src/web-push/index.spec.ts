import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { sendTestPushNotification } from './index';
import { sendPushTest } from './service';
import { SECRET_PARAMS } from '../secrets';
const mocks = vi.hoisted(() => ({ getTemplate: vi.fn(), log: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }));
vi.mock('firebase-admin/remote-config', () => ({ getRemoteConfig: () => ({ getTemplate: mocks.getTemplate }) }));
vi.mock('firebase-functions/logger', () => ({ info: mocks.log, error: mocks.log }));
vi.mock('./service', () => ({ sendPushTest: vi.fn() }));
vi.mock('web-push', async original => ({ default: { ...(await original<{ default: typeof webpush }>()).default, sendNotification: vi.fn().mockResolvedValue({}) } }));
const request = () => ({ auth: { uid: 'owner', token: {} }, app: { appId: 'test-app' },
  rawRequest: { get: () => 'https://beta.quantified-self.io' }, data: { installationId: 'opaque-id' } });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('FUNCTIONS_EMULATOR', 'false');
  vi.mocked(sendPushTest).mockResolvedValue({ status: 'accepted' });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('Web Push callable adapter', () => {
  it('requires verified App Check before service admission', async () => {
    await expect(sendTestPushNotification.run({ ...request(), app: undefined } as never)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(sendPushTest).not.toHaveBeenCalled();
  });
  it('passes authoritative identity and uses bounded private signing options', async () => {
    const pair = webpush.generateVAPIDKeys(); vi.spyOn(SECRET_PARAMS.WEB_PUSH_VAPID_KEYPAIR, 'value').mockReturnValue(JSON.stringify(pair));
    mocks.getTemplate.mockResolvedValue({ parameters: { web_push_enabled: { defaultValue: { value: 'true' } },
      web_push_vapid_public_key: { defaultValue: { value: pair.publicKey } } } });
    await sendTestPushNotification.run(request() as never);
    const [input, deps] = vi.mocked(sendPushTest).mock.calls[0];
    expect(input).toMatchObject({ uid: 'owner', origin: 'https://beta.quantified-self.io', data: request().data });
    expect(await deps.configuration()).toEqual({ enabled: true, publicKey: pair.publicKey });
    await deps.send({ endpoint: 'https://web.push.apple.com/test' } as never, 'fixed-payload');
    expect(webpush.sendNotification).toHaveBeenCalledWith(expect.anything(), 'fixed-payload', {
      TTL: 60, timeout: 5000, urgency: 'normal', vapidDetails: { subject: 'mailto:support@quantified-self.io', ...pair },
    });
    vi.restoreAllMocks();
  });
  it('does not expose unknown SDK failures or payload details', async () => {
    vi.mocked(sendPushTest).mockRejectedValue(new Error('private-canary'));
    await expect(sendTestPushNotification.run(request() as never)).rejects.toMatchObject({ code: 'unavailable', message: 'Notifications are temporarily unavailable.' });
    expect(mocks.log).toHaveBeenCalledWith('[WebPush]', { telemetryVersion: 1, outcome: 'failed' });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('private-canary');
  });
});
