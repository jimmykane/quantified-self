export const MORNING_CHECK_IN_CATEGORY = 'morning_check_in';

/** Account preferences are separate from browser permission and each sender's consent. */
export const NOTIFICATION_CATEGORIES = [{
  id: 'history_import', label: 'History imports',
  description: 'Results of history imports you explicitly ask to be notified about.',
}, {
  id: 'activity_sync', label: 'New activities synced',
  description: 'Recent workouts from connected services, grouped to limit alerts. History imports are excluded.',
}, {
  id: 'activity_delivery', label: 'Activity delivery',
  description: 'Results of sends you ask about, and grouped automatic sending failures that need attention.',
}, {
  id: MORNING_CHECK_IN_CATEGORY, label: 'Morning check-in',
  description: 'Get a Good morning alert when today’s main sleep syncs from 05:00 until noon in your saved time zone.',
}, {
  id: 'training_sync', label: 'Training sync',
  description: 'Grouped alerts when upcoming workout sync needs attention or a service needs reconnecting.',
}, {
  id: 'training_send', label: 'Training send results',
  description: 'One result for explicit sends, initial sync setup and manual retries. Background sync stays silent.',
}, {
  id: 'connection_attention', label: 'Connection issues',
  description: 'When a connected service needs reconnecting so syncing can resume. One alert per unresolved problem.',
}] as const;
export type NotificationCategoryId = typeof NOTIFICATION_CATEGORIES[number]['id'];
export interface NotificationCategoryPreference { enabled: boolean; revision: number; timeZone?: string; }

export function isNotificationCategory(value: unknown): value is NotificationCategoryId {
  return NOTIFICATION_CATEGORIES.some(category => category.id === value);
}

export function notificationPreferencePath(uid: string, category: NotificationCategoryId): string {
  return `users/${uid}/notificationPreferences/${category}`;
}

function isMorningCheckInTimeZoneIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 80 && /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(value);
}

export function isSupportedMorningCheckInTimeZone(value: unknown): value is string {
  if (!isMorningCheckInTimeZoneIdentifier(value)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
  catch { return false; }
}

/** Categories default on. Morning check-in still needs a saved time zone before it can send. */
export function readNotificationCategoryPreference(value: unknown, category?: NotificationCategoryId): NotificationCategoryPreference | null {
  const morningCheckIn = category === MORNING_CHECK_IN_CATEGORY;
  if (value === undefined) return { enabled: true, revision: 0 };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || typeof row.enabled !== 'boolean' || !Number.isSafeInteger(row.revision)
    || (row.revision as number) < 1
    || Object.keys(row).some(key => !['schemaVersion', 'enabled', 'revision', 'updatedAt', 'timeZone'].includes(key))) return null;
  const preference = { enabled: row.enabled, revision: row.revision as number };
  if (morningCheckIn && row.enabled) {
    // Devices can have different time zone databases. A saved choice must still be editable.
    return isMorningCheckInTimeZoneIdentifier(row.timeZone) ? { ...preference, timeZone: row.timeZone } : null;
  }
  return 'timeZone' in row ? null : preference;
}
