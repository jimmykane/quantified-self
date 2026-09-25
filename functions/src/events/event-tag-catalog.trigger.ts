import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { ensureEventTagCatalogEntries, newlyAssignedEventTags } from './event-tag-catalog';

export const projectEventTagCatalog = onDocumentWritten({
  document: 'users/{uid}/events/{eventId}',
  region: 'europe-west2',
  memory: '256MiB',
  retry: true,
}, async event => {
  const uid = `${event.params.uid || ''}`.trim();
  if (!uid) return;
  const tags = newlyAssignedEventTags(event.data?.before?.data(), event.data?.after?.data());
  if (!tags.length) return;
  await ensureEventTagCatalogEntries(admin.firestore(), uid, tags);
});
