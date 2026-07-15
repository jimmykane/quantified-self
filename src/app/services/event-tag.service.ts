import { inject, Injectable } from '@angular/core';
import { User } from '@sports-alliance/sports-lib';
import { AppEventInterface } from '@shared/app-event.interface';
import { sanitizeEventFirestoreWritePayload } from '@shared/firestore-write-sanitizer';
import { Firestore, deleteField, doc, runTransaction } from 'app/firebase/firestore';

import {
  applyEventTagChanges,
  EventTagChanges,
  EVENT_TAG_BULK_LIMIT,
  getEventTags,
  normalizeEventTags,
} from '@shared/event-tags';

@Injectable({ providedIn: 'root' })
export class EventTagService {
  private firestore = inject(Firestore);

  normalizeTags(value: unknown): string[] {
    return normalizeEventTags(value);
  }

  getTags(event: AppEventInterface | null | undefined): string[] {
    return getEventTags(event);
  }

  async saveTags(
    user: User,
    event: AppEventInterface,
    value: unknown,
    expectedValue: unknown = this.getTags(event),
  ): Promise<string[]> {
    const eventID = event?.getID?.();
    if (!eventID) {
      throw new Error('Cannot save tags for an event without an ID.');
    }

    const tags = normalizeEventTags(value);
    const expectedTags = normalizeEventTags(expectedValue);
    const eventRef = doc(this.firestore, 'users', user.uid, 'events', eventID);
    await runTransaction(this.firestore, async (transaction) => {
      const snapshot = await transaction.get(eventRef);
      if (!snapshot.exists()) {
        throw new Error('Tags were not changed because the event no longer exists.');
      }

      const currentTags = getEventTags(
        snapshot.data() as { tags?: unknown; benchmarkReviewTags?: unknown },
      );
      if (!this.areTagsEqual(currentTags, expectedTags)) {
        throw new Error('Tags changed elsewhere. Reopen the editor and try again.');
      }

      transaction.update(eventRef, sanitizeEventFirestoreWritePayload({
        tags,
        benchmarkReviewTags: deleteField(),
      }));
    });
    event.tags = tags;
    delete event.benchmarkReviewTags;
    return tags;
  }

  async applyBulkChanges(
    user: User,
    eventIDs: string[],
    changes: EventTagChanges,
  ): Promise<Record<string, string[]>> {
    const normalizedEventIDs = Array.from(new Set(
      (eventIDs || []).map(eventID => `${eventID || ''}`.trim()).filter(Boolean),
    ));
    if (!normalizedEventIDs.length) {
      throw new Error('Select at least one event to update tags.');
    }
    if (normalizedEventIDs.length > EVENT_TAG_BULK_LIMIT) {
      throw new Error(`Update tags on up to ${EVENT_TAG_BULK_LIMIT} events at a time.`);
    }

    const add = normalizeEventTags(changes?.add);
    const remove = normalizeEventTags(changes?.remove);
    if (!add.length && !remove.length) {
      return {};
    }

    const eventRefs = normalizedEventIDs.map(eventID => ({
      eventID,
      ref: doc(this.firestore, 'users', user.uid, 'events', eventID),
    }));

    return runTransaction(this.firestore, async (transaction) => {
      const snapshots = await Promise.all(eventRefs.map(({ ref }) => transaction.get(ref)));
      const results: Record<string, string[]> = {};

      snapshots.forEach((snapshot, index) => {
        const { eventID } = eventRefs[index];
        if (!snapshot.exists()) {
          throw new Error('Tags were not changed because one or more events no longer exist.');
        }

        const data = snapshot.data() as { tags?: unknown; benchmarkReviewTags?: unknown };
        const currentTags = Array.isArray(data.tags) ? data.tags : data.benchmarkReviewTags;
        let tags: string[];
        try {
          tags = applyEventTagChanges(currentTags, { add, remove });
        } catch {
          throw new Error('Tags were not changed because one or more events would exceed 10 tags.');
        }
        results[eventID] = tags;
      });

      eventRefs.forEach(({ eventID, ref }) => {
        transaction.update(ref, sanitizeEventFirestoreWritePayload({
          tags: results[eventID],
          benchmarkReviewTags: deleteField(),
        }));
      });

      return results;
    });
  }

  private areTagsEqual(first: string[], second: string[]): boolean {
    return first.length === second.length && first.every((tag, index) => tag === second[index]);
  }
}
