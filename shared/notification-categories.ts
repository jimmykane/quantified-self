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
}] as const;
export type NotificationCategoryId = typeof NOTIFICATION_CATEGORIES[number]['id'];
export interface NotificationCategoryPreference { enabled: boolean; revision: number; }

export function isNotificationCategory(value: unknown): value is NotificationCategoryId {
  return NOTIFICATION_CATEGORIES.some(category => category.id === value);
}

export function notificationPreferencePath(uid: string, category: NotificationCategoryId): string {
  return `users/${uid}/notificationPreferences/${category}`;
}

/** New categories default on. A failed read or malformed record is never a missing preference. */
export function readNotificationCategoryPreference(value: unknown): NotificationCategoryPreference | null {
  if (value === undefined) return { enabled: true, revision: 0 };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || typeof row.enabled !== 'boolean' || !Number.isSafeInteger(row.revision)
    || (row.revision as number) < 1
    || Object.keys(row).some(key => !['schemaVersion', 'enabled', 'revision', 'updatedAt'].includes(key))) return null;
  return { enabled: row.enabled, revision: row.revision as number };
}
