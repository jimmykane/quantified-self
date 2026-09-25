import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it } from 'vitest';

import {
  createMissingEventTagCatalogEntriesInTransaction,
  eventTagCatalogKey,
  newlyAssignedEventTags,
} from './event-tag-catalog';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('event tag catalog concurrent writes', () => {
  const db = new Firestore({ projectId: 'demo-event-tag-catalog' });
  const users: string[] = [];

  afterAll(async () => {
    for (const uid of users) await db.recursiveDelete(db.collection('users').doc(uid));
    await db.terminate();
  });

  it('keeps distinct and same-name additions from simultaneous server transactions', async () => {
    const uid = `event-tag-catalog-${randomUUID()}`;
    users.push(uid);
    const user = db.collection('users').doc(uid);
    await user.set({ test: true });
    for (const eventID of ['one', 'two', 'three']) {
      await user.collection('events').doc(eventID).set({ tags: [] });
    }

    const edit = (eventID: string, tag: string) => db.runTransaction(async transaction => {
      const eventRef = user.collection('events').doc(eventID);
      const event = await transaction.get(eventRef);
      await createMissingEventTagCatalogEntriesInTransaction(
        db, transaction, uid, newlyAssignedEventTags(event.data(), { tags: [tag] }),
      );
      transaction.update(eventRef, { tags: [tag] });
    });

    await Promise.all([edit('one', 'Race'), edit('two', 'race'), edit('three', 'Trail')]);

    for (const [eventID, tag] of [['one', 'Race'], ['two', 'race'], ['three', 'Trail']]) {
      expect((await user.collection('events').doc(eventID).get()).data()?.tags).toEqual([tag]);
    }
    const catalog = user.collection('eventTagCatalog');
    expect((await catalog.get()).size).toBe(2);
    expect((await catalog.doc(eventTagCatalogKey('Race')).get()).data()?.name.toLowerCase()).toBe('race');
    expect((await catalog.doc(eventTagCatalogKey('Trail')).get()).data()).toEqual({ name: 'Trail' });
  });
});
