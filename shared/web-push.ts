/** Browser subscription contract. Never log endpoint or encryption keys. */
export const WEB_PUSH_ORIGINS = ['https://quantified-self.io', 'https://beta.quantified-self.io'] as const;
export const WEB_PUSH_SETTINGS_PATH = '/settings?section=notifications';
export interface PushRegistration {
  schemaVersion: 1;
  origin: string;
  vapidPublicKey: string;
  generation: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export interface PushTestRequest { installationId: string; }
export interface PushTestResponse { status: 'accepted' | 'subscription_expired'; }
export function isPushId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
}
export function isVapidPublicKey(value: unknown): value is string {
  return typeof value === 'string' && /^B[A-Za-z0-9_-]{86}$/.test(value);
}
export function isPushOrigin(value: unknown, emulator = false): value is string {
  return typeof value === 'string' && ((WEB_PUSH_ORIGINS as readonly string[]).includes(value)
    || (emulator && /^https?:\/\/localhost:[0-9]{1,5}$/.test(value)));
}
export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false;
  // Exact public service hosts only; no credentials, ports, fragments or redirects.
  return /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com)\/[A-Za-z0-9_./~%?=&+\-]+$/.test(value);
}
export function isPushRegistration(value: unknown, emulator = false): value is PushRegistration {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<PushRegistration>;
  return v.schemaVersion === 1 && isPushOrigin(v.origin, emulator) && isPushId(v.generation)
    && isVapidPublicKey(v.vapidPublicKey) && isPushEndpoint(v.endpoint)
    && !!v.keys && typeof v.keys.p256dh === 'string' && /^B[A-Za-z0-9_-]{86}$/.test(v.keys.p256dh)
    && typeof v.keys.auth === 'string' && /^[A-Za-z0-9_-]{22}$/.test(v.keys.auth);
}
export function buildPushTestPayload(origin: string) {
  if (!isPushOrigin(origin, true)) throw new Error('Unsupported notification origin.');
  return { web_push: 8030, notification: {
    title: 'Quantified Self', body: 'Notifications are working on this device.', tag: 'qs-notification-test',
    navigate: origin + WEB_PUSH_SETTINGS_PATH,
    data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: WEB_PUSH_SETTINGS_PATH } } },
  } };
}
/** Future automatic senders must use this gate; beta only supports explicit tests. */
export function isAutomaticPushOrigin(origin: string): boolean { return origin === WEB_PUSH_ORIGINS[0]; }
