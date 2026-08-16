import { describe, expect, it } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

import { COROSEventMetaData } from './event-metadata';

const baseItem = {
  id: 'queue-id',
  openId: 'open-id',
  workoutID: '418173315956375553',
  dateCreated: 1,
  retryCount: 0,
  processed: false,
  dispatchedToCloudTask: null,
} as const;

describe('COROSEventMetaData', () => {
  it('preserves normalized workout metadata with stable component identity', () => {
    const metadata = new COROSEventMetaData({
      ...baseItem,
      FITFileURI: 'https://oss.coros.com/fit/signed.fit?signature=secret',
      mode: 9,
      subMode: 6,
      deviceName: 'COROS DURA',
      startTimezone: 8,
      endTimezone: 12,
      planWorkoutId: '443847671331979261',
      componentIndex: 1,
      componentKey: 'component:1:9:6',
    }, new Date('2026-08-15T10:00:00.000Z')).toJSON();

    expect(metadata).toEqual({
      serviceWorkoutID: '418173315956375553',
      serviceName: ServiceNames.COROSAPI,
      serviceOpenId: 'open-id',
      date: Date.parse('2026-08-15T10:00:00.000Z'),
      serviceMode: 9,
      serviceSubMode: 6,
      serviceDeviceName: 'COROS DURA',
      serviceStartTimezone: 8,
      serviceEndTimezone: 12,
      servicePlanWorkoutID: '443847671331979261',
      serviceWorkoutComponentIndex: 1,
      serviceWorkoutComponentKey: 'component:1:9:6',
    });
    expect(metadata).not.toHaveProperty('serviceFITFileURI');
  });

  it('retains the FIT URL identity for legacy queue items only', () => {
    expect(new COROSEventMetaData({
      ...baseItem,
      FITFileURI: 'https://oss.coros.com/fit/legacy.fit',
    }, new Date(0)).toJSON()).toMatchObject({
      serviceFITFileURI: 'https://oss.coros.com/fit/legacy.fit',
    });
  });
});
