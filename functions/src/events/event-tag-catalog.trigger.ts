import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import {
  EVENT_TAG_CATALOG_SUBMISSION_COLLECTION,
  EVENT_TAG_CATALOG_SUBMISSION_DOCUMENT,
  normalizeEventTags,
} from '../../../shared/event-tags';
import { ensureEventTagCatalogEntries, newlyAssignedEventTags } from './event-tag-catalog';

export const projectEventTagCatalog = onDocumentWritten({
  document: 'users/{uid}/events/{eventId}',
  region: 'europe-west2',
  retry: true,
}, async event => {
  const uid = `${event.params.uid || ''}`.trim();
  if (!uid) return;
  const tags = newlyAssignedEventTags(event.data?.before?.data(), event.data?.after?.data());
  if (!tags.length) return;
  await ensureEventTagCatalogEntries(admin.firestore(), uid, tags);
});

export const projectEventTagCatalogSubmission = onDocumentWritten({
  document: `users/{uid}/${EVENT_TAG_CATALOG_SUBMISSION_COLLECTION}/${EVENT_TAG_CATALOG_SUBMISSION_DOCUMENT}`,
  region: 'europe-west2',
  retry: true,
}, async event => {
  const uid = `${event.params.uid || ''}`.trim();
  if (!uid || !event.data?.after?.exists) return;
  const tags = normalizeEventTags(event.data.after.data()?.tags);
  if (!tags.length) return;
  await ensureEventTagCatalogEntries(admin.firestore(), uid, tags);
});
