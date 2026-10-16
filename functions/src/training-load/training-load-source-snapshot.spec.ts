import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { trainingLoadSourceSnapshot } from './training-load-source-snapshot';

const snapshot = (id: string, data: Record<string, unknown>, updateTime: Timestamp) => ({ id, data: () => data, updateTime });
function multisport() {
  return {
    parent: snapshot('workout', { name: 'Multisport', startDate: new Timestamp(1000, 123456789),
      endDate: new Timestamp(4600, 987654321), stats: { Duration: 3600, 'Training Stress Score': 9 }, tags: ['test'] },
    new Timestamp(5000, 123456789)),
    activities: [
      snapshot('walk', { eventID: 'workout', type: 'Walking', stats: { Energy: 210, Weight: 70, 'Training Stress Score': 9 } },
        new Timestamp(5001, 1)),
      snapshot('transition', { eventID: 'workout', type: 'Transition', stats: { Duration: 0, 'Training Stress Score': 0 } },
        new Timestamp(5002, 999999999)),
    ],
  };
}

describe('persisted Training load source snapshot compatibility', () => {
  it('preserves the pre-extraction digest and exact source write timestamps', () => {
    const { parent, activities } = multisport();
    expect(trainingLoadSourceSnapshot(parent, activities)).toEqual({
      // Captured from the original import/merge calculation before extracting this helper.
      sourceDigest: 'cdb180a476c880d6b9a8270e48222b8a6937e672b5ac3578168206deb9f17c5d',
      sourceWriteTimes: { event: '5000:123456789', 'activity:walk': '5001:1', 'activity:transition': '5002:999999999' },
    });
    expect(activities.map(doc => doc.id)).toEqual(['walk', 'transition']);
  });

  it('ignores leg iteration and map field order without changing source identity', () => {
    const { parent, activities } = multisport();
    const reordered = snapshot(parent.id, { ...parent.data(), stats: { 'Training Stress Score': 9, Duration: 3600 } }, parent.updateTime);
    expect(trainingLoadSourceSnapshot(reordered, [...activities].reverse())).toEqual(trainingLoadSourceSnapshot(parent, activities));
  });

  it('refreshes exact write times without treating ingestion bookkeeping as a source change', () => {
    const { parent, activities } = multisport();
    const before = trainingLoadSourceSnapshot(parent, activities);
    const rewritten = snapshot(parent.id, { ...parent.data(), originalFiles: [{ path: 'synthetic.fit' }], processingVersion: 'next' },
      new Timestamp(5000, 123456790));
    const after = trainingLoadSourceSnapshot(rewritten, activities);
    expect(after.sourceDigest).toBe(before.sourceDigest);
    expect(after.sourceWriteTimes).toEqual({ ...before.sourceWriteTimes, event: '5000:123456790' });
  });

  it.each(['parent metric', 'leg metric', 'zero-load leg removal', 'leg identity', 'swim lengths'])(
    'retains source-change detection for %s', change => {
      const { parent, activities } = multisport();
      const before = trainingLoadSourceSnapshot(parent, activities);
      if (change === 'parent metric') parent.data().stats = { Duration: 3600, 'Training Stress Score': 10 };
      if (change === 'leg metric') activities[0].data().stats = { Energy: 420, Weight: 70, 'Training Stress Score': 9 };
      if (change === 'zero-load leg removal') activities.pop();
      if (change === 'leg identity') activities[1].id = 'new-transition';
      if (change === 'swim lengths') activities[0].data().swimLengths = [{ distance: 25, duration: 30 }];
      expect(trainingLoadSourceSnapshot(parent, activities).sourceDigest).not.toBe(before.sourceDigest);
    },
  );
});
