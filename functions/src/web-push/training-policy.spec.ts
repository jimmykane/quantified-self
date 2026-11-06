import { describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { trainingSyncNotificationPayload, TRAINING_SYNC_NOTIFICATION_PATH } from '../../../shared/training-sync-notifications';
import { trainingAttention } from './training-policy';
describe('training notification policy', () => {
  it.each(['https://quantified-self.io', 'https://beta.quantified-self.io'])('uses standard/declarative generic payloads on %s', origin => {
    const payload = trainingSyncNotificationPayload(origin);
    expect(payload.web_push).toBe(8030); expect(payload.notification.renotify).toBe(false);
    expect(payload.notification.navigate).toBe(origin + TRAINING_SYNC_NOTIFICATION_PATH);
    expect(payload.notification.data.onActionClick.default.url).toBe(TRAINING_SYNC_NOTIFICATION_PATH);
    expect(payload.notification.icon).toBe(origin + '/assets/favicons/android-chrome-192x192.png');
  });
  it.each(['http://localhost:4200', 'https://attacker.invalid'])('rejects unsupported origin %s', origin => {
    expect(() => trainingSyncNotificationPayload(origin)).toThrow();
  });
  it('keeps temporary and deliberate pauses outside the actionable states', () => {
    for (const status of ['pending', 'retrying', 'paused_plan', 'paused_pro', 'outside_horizon', 'stopped', 'removed']) expect(trainingAttention(status)).toBe(false);
    for (const status of ['failed', 'needs_attention', 'reconnect_required', 'connection_repair']) expect(trainingAttention(status)).toBe(true);
  });
});
