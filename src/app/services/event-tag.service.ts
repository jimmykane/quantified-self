import { inject, Injectable } from '@angular/core';
import { User } from '@sports-alliance/sports-lib';
import { AppEventInterface } from '@shared/app-event.interface';
import { sanitizeEventFirestoreWritePayload } from '@shared/firestore-write-sanitizer';
import { Firestore, deleteField, doc, runTransaction } from 'app/firebase/firestore';

import {
  applyEventTagChanges,
  EventTagChanges,
  EVENT_TAG_BULK_LIMIT,
  EVENT_TAG_CATALOG_SUBMISSION_COLLECTION,
  EVENT_TAG_CATALOG_SUBMISSION_DOCUMENT,
  getEventTags,
  newlyAssignedEventTags,
  normalizeEventTags,
} from '@shared/event-tags';
import { EventTagCatalogService } from './event-tag-catalog.service';

@Injectable({ providedIn: 'root' })
export class EventTagService {
  private firestore = inject(Firestore);
  private catalog = inject(EventTagCatalogService);

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
    const submissionRef = doc(this.firestore, 'users', user.uid,
      EVENT_TAG_CATALOG_SUBMISSION_COLLECTION, EVENT_TAG_CATALOG_SUBMISSION_DOCUMENT);
    await runTransaction(this.firestore, async (transaction) => {
      const snapshot = await transaction.get(eventRef);
      if (!snapshot.exists()) {
        throw new Error('Tags were not changed because the event no longer exists.');
      }

      const currentData = snapshot.data() as { tags?: unknown; benchmarkReviewTags?: unknown };
      const currentTags = getEventTags(currentData);
      if (!this.areTagsEqual(currentTags, expectedTags)) {
        throw new Error('Tags changed elsewhere. Reopen the editor and try again.');
      }

      transaction.update(eventRef, sanitizeEventFirestoreWritePayload({
        tags,
        benchmarkReviewTags: deleteField(),
      }));
      const additions = newlyAssignedEventTags(currentData, { tags });
      if (additions.length) transaction.set(submissionRef, { tags: additions });
    });
    event.tags = tags;
    delete event.benchmarkReviewTags;
    this.catalog.noteSavedTags(user.uid, tags);
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
    const submissionRef = doc(this.firestore, 'users', user.uid,
      EVENT_TAG_CATALOG_SUBMISSION_COLLECTION, EVENT_TAG_CATALOG_SUBMISSION_DOCUMENT);

    const results = await runTransaction(this.firestore, async (transaction) => {
      const snapshots = await Promise.all(eventRefs.map(({ ref }) => transaction.get(ref)));
      const results: Record<string, string[]> = {};
      const additions = new Map<string, string>();

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
        for (const tag of newlyAssignedEventTags(data, { tags })) {
          additions.set(tag.toLowerCase(), tag);
        }
      });

      eventRefs.forEach(({ eventID, ref }) => {
        transaction.update(ref, sanitizeEventFirestoreWritePayload({
          tags: results[eventID],
          benchmarkReviewTags: deleteField(),
        }));
      });
      if (additions.size) transaction.set(submissionRef, { tags: [...additions.values()] });

      return results;
    });
    this.catalog.noteSavedTags(user.uid, Object.values(results).flat());
    return results;
  }

  private areTagsEqual(first: string[], second: string[]): boolean {
    return first.length === second.length && first.every((tag, index) => tag === second[index]);
  }
}
