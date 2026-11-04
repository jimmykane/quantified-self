import { describe, expect, it } from 'vitest';
import { nextNotificationInvitation, notificationInvitationDue, NOTIFICATION_INVITATION_SNOOZE_MS as month } from './notification-invitation.helper';

describe('notification invitation choices', () => {
  it('offers missing preferences but fails closed for malformed state', () => {
    expect(notificationInvitationDue(undefined, 100)).toBe(true);
    for (const value of [null, {}, { version: 1, choice: 'snoozed' }, { version: 2, choice: 'snoozed', until: 1 }]) {
      expect(notificationInvitationDue(value, 100)).toBe(false);
    }
  });
  it('snoozes for thirty days, allows one reminder, then stops', () => {
    const first = nextNotificationInvitation(undefined, 'snoozed', 100);
    expect(notificationInvitationDue(first, month + 99)).toBe(false);
    expect(notificationInvitationDue(first, month + 100)).toBe(true);
    expect(notificationInvitationDue(nextNotificationInvitation(first, 'snoozed', month + 100), 10 * month)).toBe(false);
  });
  it('does not consume the reminder twice for simultaneous dismissals', () => {
    const first = nextNotificationInvitation(undefined, 'snoozed', 100);
    expect(nextNotificationInvitation(first, 'snoozed', 101)).toEqual(first);
  });
  it.each(['dismissed', 'disabled', 'enabled'] as const)('never revives %s through a stale snooze action', choice => {
    const saved = nextNotificationInvitation(undefined, choice, 100);
    expect(notificationInvitationDue(saved, 10 * month)).toBe(false);
    expect(nextNotificationInvitation(saved, 'snoozed', 10 * month)).toEqual(saved);
  });
});
