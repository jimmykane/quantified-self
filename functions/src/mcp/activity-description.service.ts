import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';

export const MCP_ACTIVITY_DESCRIPTION_MAX_LENGTH = 65_536;
export const MCP_ACTIVITY_DESCRIPTION_MAX_BYTES = 64 * 1024;
export const MCP_ACTIVITY_DESCRIPTION_MAX_RESULT_BYTES = 128 * 1024;
export interface McpActivityDescriptionInput {
  uid: string;
  connectionId: string;
  scopes: readonly string[];
  activityRef: string;
}
interface Document { id: string; data: Record<string, unknown> }
export interface McpActivityDescriptionReads {
  activeOwner(uid: string): Promise<boolean>;
  fetchActivity(uid: string, activityId: string): Promise<Document | null>;
  fetchEvent(uid: string, eventId: string): Promise<Document | null>;
}

// OAuth reads reuse the existing MCP backend. No new callable, writes, or source parsing is needed.
async function fetchProjection(uid: string, collection: 'activities' | 'events', id: string, field: string) {
  const snapshot = await admin.firestore().collection('users').doc(uid).collection(collection)
    .where(FieldPath.documentId(), '==', id).select(field).limit(1).get();
  const doc = snapshot.docs[0];
  return doc ? { id: doc.id, data: doc.data() } : null;
}
export const firestoreActivityDescriptionReads: McpActivityDescriptionReads = {
  async activeOwner(uid) { return !(await getUserDeletionGuardState(admin.firestore(), uid)).shouldSkip; },
  fetchActivity: (uid, activityId) => fetchProjection(uid, 'activities', activityId, 'eventID'),
  fetchEvent: (uid, eventId) => fetchProjection(uid, 'events', eventId, 'description'),
};
