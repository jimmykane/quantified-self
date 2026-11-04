export type NotificationInvitationChoice = 'snoozed' | 'dismissed' | 'enabled' | 'disabled';
export interface NotificationInvitation {
  version: 1;
  choice: NotificationInvitationChoice;
  until?: number;
}
export const NOTIFICATION_INVITATION_SNOOZE_MS = 30 * 86400000;

/** Missing means not yet offered; malformed saved preferences fail closed. */
export function readNotificationInvitation(value: unknown): NotificationInvitation | null | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') return null;
  const record = value as NotificationInvitation;
  if (record.version !== 1 || !['snoozed', 'dismissed', 'enabled', 'disabled'].includes(record.choice)) return null;
  if (record.choice === 'snoozed' && (!Number.isSafeInteger(record.until) || record.until! <= 0)) return null;
  return record;
}

export function notificationInvitationDue(value: unknown, now: number): boolean {
  const record = readNotificationInvitation(value);
  return record === undefined || !!record && record.choice === 'snoozed' && record.until! <= now;
}

export function nextNotificationInvitation(value: unknown, choice: NotificationInvitationChoice, now: number): NotificationInvitation {
  const current = readNotificationInvitation(value);
  if (choice !== 'snoozed') return { version: 1, choice };
  // Concurrent dismissals must not count as two reminders or resurrect an explicit choice.
  if (current === null) throw new Error('Invalid notification invitation preference.');
  if (current && current.choice !== 'snoozed') return current;
  if (current?.choice === 'snoozed') return current.until! > now ? current : { version: 1, choice: 'dismissed' };
  return { version: 1, choice: 'snoozed', until: now + NOTIFICATION_INVITATION_SNOOZE_MS };
}
