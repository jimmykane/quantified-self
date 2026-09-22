import { randomUUID } from 'node:crypto';
import { FieldPath, Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMcpTimelineNote,
  deleteMcpTimelineNote,
  McpContentWriteError,
  queryEditableMcpTimelineNotes,
  updateMcpActivityTags,
  updateMcpTimelineNote,
  type McpContentWriteCodec,
  type McpContentWriteDependencies,
} from './content-write.service';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'MCP activity-tag and Timeline-note changes with real Firestore transactions',
  { timeout: 30_000 },
  () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
      throw new Error('Loopback emulator required.');
    }
    const db = new Firestore({ projectId: 'demo-mcp-content-writes' });
    const users: string[] = [];
    const activityScopes = ['activity-details:read', 'activity-tags:write'];
    const noteScopes = ['timeline-notes:read', 'timeline-notes:write'];
    const now = () => Date.parse('2026-09-22T12:00:00Z');
    let uid: string;
    let deps: McpContentWriteDependencies;

    const codec: McpContentWriteCodec = {
      decodeActivityRef(value, owner, connectionId) {
        if (value !== `activity:${owner}:${connectionId}`) throw new Error('invalid');
        return { activityId: 'activity-1', eventId: 'event-1' };
      },
      encodeNoteRef(value, owner, connectionId) {
        return `note:${String(value.id)}:${owner}:${connectionId}`;
      },
      decodeNoteRef(value, owner, connectionId) {
        const suffix = `:${owner}:${connectionId}`;
        if (!value.startsWith('note:') || !value.endsWith(suffix)) throw new Error('invalid');
        return { id: value.slice(5, -suffix.length) };
      },
      encodeEditCursor(value, owner, connectionId) {
        return Buffer.from(JSON.stringify({ value, owner, connectionId })).toString('base64url');
      },
      decodeEditCursor(value, owner, connectionId) {
        const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
          value: Record<string, unknown>; owner: string; connectionId: string;
        };
        if (decoded.owner !== owner || decoded.connectionId !== connectionId) throw new Error('invalid');
        return decoded.value;
      },
    };

    beforeEach(async () => {
      uid = `mcp-content-write-${randomUUID()}`;
      users.push(uid);
      const user = db.collection('users').doc(uid);
      await user.set({ test: true });
      await user.collection('mcpConnections').doc('connection').set({
        status: 'active', scopes: [...activityScopes, ...noteScopes],
        grantId: 'grant-1', createdAtMs: 1, revokedAtMs: null,
      });
      deps = {
        db,
        now,
        timelineNotesReads: {
          async activeOwner() { return true; },
          async fetchPage(owner, range, phase, limit, position) {
            let query = db.collection('users').doc(owner).collection('timelineNotes')
              .where('startDate', '<=', range.endDate)
              .where('endDate', phase === 'closed' ? '>=' : '==', phase === 'closed' ? range.startDate : null)
              .orderBy('endDate').orderBy('startDate').orderBy(FieldPath.documentId())
              .select('category', 'title', 'details', 'startDate', 'endDate', 'timeZone',
                'showOnCharts', 'color', 'revision', 'createdAtMs', 'updatedAtMs')
              .limit(limit);
            if (position) query = query.startAfter(position.endDate, position.startDate, position.id);
            return (await query.get()).docs.map(document => ({ id: document.id, data: document.data() }));
          },
        },
      };
    });

    afterAll(async () => {
      for (const owner of users) await db.recursiveDelete(db.collection('users').doc(owner));
      await db.terminate();
    });

    it('replaces shared event tags idempotently and rejects a stale replacement', async () => {
      const user = db.collection('users').doc(uid);
      await user.collection('activities').doc('activity-1').set({ eventID: 'event-1' });
      await user.collection('events').doc('event-1').set({ tags: ['Easy', 'Morning'] });
      const input = {
        uid, connectionId: 'connection', scopes: activityScopes,
        arguments: {
          activityRef: `activity:${uid}:connection`,
          expectedTags: ['Easy', 'Morning'],
          tags: ['Easy', 'Trail'],
        },
      };

      await expect(updateMcpActivityTags(input, codec, deps)).resolves.toEqual({
        activityRef: `activity:${uid}:connection`, tags: ['Easy', 'Trail'], changed: true,
      });
      await expect(updateMcpActivityTags(input, codec, deps)).resolves.toMatchObject({ changed: false });
      expect((await user.collection('events').doc('event-1').get()).data()).toEqual({ tags: ['Easy', 'Trail'] });

      await user.collection('events').doc('event-1').update({ tags: ['Coach'] });
      await expect(updateMcpActivityTags(input, codec, deps)).rejects.toMatchObject({
        code: 'invalid_request',
      });
    });

    it('creates, discovers, edits and permanently deletes a note with safe retries', async () => {
      const createInput = {
        uid, connectionId: 'connection', scopes: noteScopes,
        arguments: {
          category: 'travel', title: 'Altitude camp', details: 'Arrived in the evening.',
          startDate: '2026-09-20', endDate: '2026-09-24', timeZone: 'Europe/Helsinki',
          showOnCharts: false, color: 'purple', mutationId: randomUUID(),
        },
      };
      const created = await createMcpTimelineNote(createInput, codec, deps);
      await expect(createMcpTimelineNote(createInput, codec, deps)).resolves.toEqual(created);

      const query = await queryEditableMcpTimelineNotes({
        uid, connectionId: 'connection', scopes: noteScopes,
        arguments: { startDate: '2026-09-01', endDate: '2026-09-30', limit: 25 },
      }, codec, deps);
      expect(query).toMatchObject({
        scanComplete: true,
        notes: [{
          noteRef: created.noteRef, revision: 1, title: 'Altitude camp',
          showOnCharts: false, color: 'purple',
        }],
      });

      const updateInput = {
        uid, connectionId: 'connection', scopes: noteScopes,
        arguments: {
          noteRef: created.noteRef, expectedRevision: 1,
          category: 'travel', title: 'Altitude camp', details: null,
          startDate: '2026-09-20', endDate: '2026-09-24', timeZone: 'Europe/Helsinki',
          showOnCharts: false, color: 'purple',
        },
      };
      const updated = await updateMcpTimelineNote(updateInput, codec, deps);
      expect(updated).toMatchObject({ operation: 'updated', revision: 2, note: { details: null } });
      await expect(updateMcpTimelineNote(updateInput, codec, deps)).resolves.toEqual(updated);
      await expect(updateMcpTimelineNote({
        ...updateInput,
        arguments: { ...updateInput.arguments, title: 'Stale overwrite' },
      }, codec, deps)).rejects.toBeInstanceOf(McpContentWriteError);

      await expect(deleteMcpTimelineNote({
        uid, connectionId: 'connection', scopes: noteScopes,
        arguments: { noteRef: created.noteRef, expectedRevision: 2 },
      }, codec, deps)).resolves.toMatchObject({ operation: 'deleted', deleted: true });
      await expect(deleteMcpTimelineNote({
        uid, connectionId: 'connection', scopes: noteScopes,
        arguments: { noteRef: created.noteRef, expectedRevision: 2 },
      }, codec, deps)).resolves.toMatchObject({ operation: 'deleted', deleted: false });
      expect((await db.collection('users').doc(uid).collection('timelineNotes').get()).empty).toBe(true);
      expect((await db.collection('users').doc(uid).collection('timelineNoteDeletions').get()).docs[0].data())
        .toEqual({ deleted: true });
    });

    it('rechecks the stored grant and rejects cross-connection references', async () => {
      const user = db.collection('users').doc(uid);
      await user.collection('activities').doc('activity-1').set({ eventID: 'event-1' });
      await user.collection('events').doc('event-1').set({ tags: [] });
      await user.collection('mcpConnections').doc('connection').update({ revokedAtMs: now(), status: 'revoked' });
      await expect(updateMcpActivityTags({
        uid, connectionId: 'connection', scopes: activityScopes,
        arguments: { activityRef: `activity:${uid}:connection`, expectedTags: [], tags: ['Private'] },
      }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });

      await user.collection('mcpConnections').doc('other').set({
        status: 'active', scopes: noteScopes, grantId: 'grant-2', createdAtMs: 2, revokedAtMs: null,
      });
      await expect(deleteMcpTimelineNote({
        uid, connectionId: 'other', scopes: noteScopes,
        arguments: { noteRef: `note:${'a'.repeat(64)}:${uid}:connection`, expectedRevision: 1 },
      }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
    });
  },
);
