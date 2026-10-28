import * as admin from 'firebase-admin';

export const MCP_ACTIVITY_TAG_EVENT_FIELDS = [
  'tags',
  'benchmarkReviewTags',
] as const;

export interface McpActivityTagDocument {
  id: string;
  data: Record<string, unknown>;
}

export interface McpActivityTagReads {
  fetchEvents: (
    uid: string,
    eventIds: readonly string[],
  ) => Promise<McpActivityTagDocument[]>;
}

export const firestoreActivityTagReads: McpActivityTagReads = {
  fetchEvents: async (uid, eventIds) => {
    if (eventIds.length === 0) {
      return [];
    }
    const eventReferences = eventIds.map(eventId => admin.firestore()
      .collection('users')
      .doc(uid)
      .collection('events')
      .doc(eventId));
    const snapshots = await admin.firestore().getAll(
      ...eventReferences,
      { fieldMask: [...MCP_ACTIVITY_TAG_EVENT_FIELDS] },
    );
    return snapshots.flatMap(snapshot => snapshot.exists
      ? [{ id: snapshot.id, data: snapshot.data() as Record<string, unknown> }]
      : []);
  },
};
