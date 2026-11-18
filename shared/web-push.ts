import type { NotificationCategoryId } from './notification-categories';

/** Browser subscription contract. Never log endpoint or encryption keys. */
export const WEB_PUSH_ORIGINS = ['https://quantified-self.io', 'https://beta.quantified-self.io'] as const;
export const WEB_PUSH_SETTINGS_PATH = '/settings?section=notifications';
export const PUSH_BROWSERS = ['Chrome', 'Safari', 'Firefox', 'Edge', 'Opera', 'Samsung Internet', 'Browser'] as const;
export const PUSH_PLATFORMS = ['macOS', 'Windows', 'Android', 'iOS', 'ChromeOS', 'Linux', 'Unknown device'] as const;
export interface PushDeviceInfo {
  browser: typeof PUSH_BROWSERS[number];
  platform: typeof PUSH_PLATFORMS[number];
}
export function isPushDeviceInfo(value: unknown): value is PushDeviceInfo {
  if (!value || typeof value !== 'object') return false;
  const info = value as PushDeviceInfo;
  return Object.keys(value).length === 2 && PUSH_BROWSERS.includes(info.browser) && PUSH_PLATFORMS.includes(info.platform);
}
export interface PushRegistration {
  schemaVersion: 1;
  origin: string;
  vapidPublicKey: string;
  generation: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  device?: PushDeviceInfo;
}
export type PushClientRemovalReason = 'disabled_on_device' | 'disabled_from_device_list' | 'signed_out' | 'account_switch' | 'custom_token_sign_in'
  | 'permission_denied' | 'browser_subscription_missing' | 'signing_key_changed' | 'invalid_registration';

export const PUSH_REMOVAL_LOG = 'Web push device removal';
export interface PushRemovalEvent {
  uid: string;
  installationId: string;
  reason: PushClientRemovalReason | 'registration_already_missing' | 'account_changed' | 'push_service_expired';
  action: 'browser_detached' | 'registration_removed' | 'registration_delete_acknowledged';
  origin: unknown;
  device: unknown;
  sender?: NotificationCategoryId | 'test';
}

async function pushLogRef(kind: 'account' | 'device', value: string): Promise<string> {
  const bytes = new TextEncoder().encode(`qs-web-push:${kind}:${value}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Both log sinks can be searched from a known UID, without sending the UID or subscription credentials. */
export async function logPushRemoval(write: (message: string, attributes: Record<string, string>) => void, event: PushRemovalEvent): Promise<void> {
  try {
    const [accountRef, deviceRef] = await Promise.all([pushLogRef('account', event.uid), pushLogRef('device', event.installationId)]);
    const device = isPushDeviceInfo(event.device) ? event.device : null;
    write(PUSH_REMOVAL_LOG, { accountRef, deviceRef, reason: event.reason, action: event.action,
      origin: isPushOrigin(event.origin) ? event.origin : 'unknown', browser: device?.browser ?? 'unknown',
      platform: device?.platform ?? 'unknown', ...(event.sender ? { sender: event.sender } : {}) });
  } catch { /* Telemetry must never interrupt a removal or retry a delivery. */ }
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
  // Known public services only. WNS assigns one DNS label under notify.windows.com.
  // No credentials, ports, fragments, arbitrary subdomains or redirects.
  // Chrome FCM tokens contain colons in the path. Keep this grammar in sync with Rules.
  return /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.notify\.windows\.com)\/[A-Za-z0-9_./~%?=&+:-]+$/.test(value);
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
    icon: origin + '/assets/favicons/android-chrome-192x192.png',
    navigate: origin + WEB_PUSH_SETTINGS_PATH,
    data: { onActionClick: { default: { operation: 'openWindow', url: WEB_PUSH_SETTINGS_PATH } } },
  } };
}
/** Both deployed sites share account consent and rate limits; local/arbitrary origins stay excluded. */
export function isAutomaticPushOrigin(origin: string): boolean { return isPushOrigin(origin); }
