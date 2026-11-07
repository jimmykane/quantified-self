import { describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ServiceNames } from '@sports-alliance/sports-lib';
import { buildPushTestPayload, WEB_PUSH_ORIGINS } from '../../../shared/web-push';
import { buildHistoryNotificationPayload } from '../../../shared/history-import-notifications';
import { deliveryNotificationPayload } from '../../../shared/activity-delivery-notifications';
import { trainingSyncNotificationPayload } from '../../../shared/training-sync-notifications';
import { activityNotificationPayload, type ActivityPushEntry } from './activity-policy';

const activity: ActivityPushEntry = {
  eventID: 'event/id ?&', service: ServiceNames.GarminAPI, queueId: 'queue', queueRevision: null,
  queueCreatedAt: 1, startMs: 1, endMs: 2, connectedAtMs: 0, connectionGeneration: 'connection',
};
const cases = [
  { name: 'self-test', path: '/settings?section=notifications', build: buildPushTestPayload },
  { name: 'Suunto history completion', path: `/services?serviceName=${encodeURIComponent(ServiceNames.SuuntoApp)}&tool=history`,
    build: (origin: string) => buildHistoryNotificationPayload(origin, ServiceNames.SuuntoApp, 'finished') },
  { name: 'COROS history issues', path: `/services?serviceName=${encodeURIComponent(ServiceNames.COROSAPI)}&tool=history`,
    build: (origin: string) => buildHistoryNotificationPayload(origin, ServiceNames.COROSAPI, 'issues') },
  { name: 'Wahoo history attention', path: `/services?serviceName=${encodeURIComponent(ServiceNames.WahooAPI)}&tool=history`,
    build: (origin: string) => buildHistoryNotificationPayload(origin, ServiceNames.WahooAPI, 'attention') },
  { name: 'single activity with escaped identifiers', path: '/user/owner%2Fid%20%3F%26/event/event%2Fid%20%3F%26',
    build: (origin: string) => activityNotificationPayload(origin, 'owner/id ?&', [activity]) },
  { name: 'grouped activities', path: '/activities',
    build: (origin: string) => activityNotificationPayload(origin, 'owner', [activity, { ...activity, eventID: 'second' }]) },
  { name: 'manual delivery result', path: '/send-activities/suunto?batch=batch-1&source=files',
    build: (origin: string) => deliveryNotificationPayload(origin, '/send-activities/suunto?batch=batch-1&source=files', false) },
  { name: 'grouped delivery results', path: '/send-activities',
    build: (origin: string) => deliveryNotificationPayload(origin, '/send-activities', false) },
  { name: 'automatic delivery failure', path: `/services?serviceName=${encodeURIComponent(ServiceNames.SuuntoApp)}`,
    build: (origin: string) => deliveryNotificationPayload(origin, `/services?serviceName=${encodeURIComponent(ServiceNames.SuuntoApp)}`, true) },
  { name: 'training sync attention', path: '/training/plans?sync=attention', build: trainingSyncNotificationPayload },
];

describe.each(WEB_PUSH_ORIGINS)('notification navigation on %s', origin => {
  it.each([1, 2])('requests fresh attention for a batch of %i activities while retaining its replacement tag', count => {
    const entries = Array.from({ length: count }, (_, i) => ({ ...activity, eventID: `event-${i}` }));
    expect(activityNotificationPayload(origin, 'owner', entries).notification)
      .toMatchObject({ tag: 'qs-activity-sync', renotify: true });
  });
  it.each(cases)('delegates $name to browser app/window routing with its exact destination', ({ build, path }) => {
    const payload = build(origin);
    // openWindow lets the browser select an installed app instead of navigating the last-focused tab.
    expect(payload.notification.data.onActionClick).toEqual({ default: { operation: 'openWindow', url: path } });
    // Native declarative delivery must keep the same destination on the subscription's own origin.
    expect(payload.web_push).toBe(8030);
    expect(payload.notification.navigate).toBe(origin + path);
  });
});
