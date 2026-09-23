import { randomUUID } from 'node:crypto';
import { FieldPath, Firestore, Timestamp } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMcpTimelineNote,
  deleteMcpTimelineNote,
  getMcpEventTitle,
  McpContentWriteError,
  queryEditableMcpTimelineNotes,
  updateMcpEventTags,
  updateMcpEventTitle,
  updateMcpEventDescription,
  updateMcpTimelineNote,
  type McpContentWriteCodec,
  type McpContentWriteDependencies,
} from './content-write.service';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'MCP event-tag and Timeline-note changes with real Firestore transactions',
  { timeout: 30_000 },
  () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
      throw new Error('Loopback emulator required.');
    }
    const db = new Firestore({ projectId: 'demo-mcp-content-writes' });
    const users: string[] = [];
    const activityScopes = ['activity-details:read', 'events:write'];
    const descriptionScopes = [...activityScopes, 'activity-descriptions:read'];
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
        status: 'active', scopes: [...descriptionScopes, ...noteScopes],
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
      for (const owner of users) {
        await db.recursiveDelete(db.collection('users').doc(owner));
        await db.collection('userDeletionTombstones').doc(owner).delete();
      }
      await db.terminate();
    });

    it('replaces shared event tags idempotently and rejects a stale replacement', async () => {
      const user = db.collection('users').doc(uid);
      await user.collection('activities').doc('activity-1').set({ eventID: 'event-1' });
      await user.collection('events').doc('event-1').set({
        tags: ['Easy', 'Morning'],
        benchmarkReviewTags: ['Legacy'],
        mergeType: 'multi',
        isMerge: true,
      });
      const input = {
        uid, connectionId: 'connection', grantId: 'grant-1', scopes: activityScopes,
        arguments: {
          activityRef: `activity:${uid}:connection`,
          expectedTags: ['Easy', 'Morning'],
          tags: ['Easy', 'Trail'],
        },
      };

      await expect(updateMcpEventTags(input, codec, deps)).resolves.toEqual({
        activityRef: `activity:${uid}:connection`, tags: ['Easy', 'Trail'], changed: true,
      });
      await expect(updateMcpEventTags(input, codec, deps)).resolves.toMatchObject({ changed: false });
      expect((await user.collection('events').doc('event-1').get()).data()).toEqual({
        tags: ['Easy', 'Trail'],
        mergeType: 'multi',
        isMerge: true,
      });

      await user.collection('events').doc('event-1').update({ tags: ['Coach'] });
      await expect(updateMcpEventTags(input, codec, deps)).rejects.toMatchObject({
        code: 'invalid_request',
      });
    });

    it('edits the shared event title and description with exact current-value checks', async () => {
      const user = db.collection('users').doc(uid);
      await user.collection('activities').doc('activity-1').set({ eventID: 'event-1' });
      await user.collection('activities').doc('sibling').set({ eventID: 'event-1' });
      await user.collection('events').doc('event-1').set({
        name: 'Morning run', description: 'Easy.', tags: ['Trail'],
      });
      const context = { uid, connectionId: 'connection', grantId: 'grant-1',
        scopes: descriptionScopes };
      const activityRef = `activity:${uid}:connection`;
      await expect(getMcpEventTitle({ ...context, arguments: { activityRef } }, codec, deps))
        .resolves.toEqual({ activityRef, title: 'Morning run' });
      const rename = { ...context, arguments: {
        activityRef, expectedTitle: 'Morning run', title: '  Evening ride  ',
      } };
      await expect(updateMcpEventTitle(rename, codec, deps)).resolves.toEqual({
        activityRef, title: '  Evening ride  ', changed: true,
      });
      await expect(updateMcpEventTitle(rename, codec, deps)).resolves.toMatchObject({ changed: false });
      await expect(updateMcpEventTitle({ ...context, arguments: {
        activityRef, expectedTitle: 'Morning run', title: 'Stale edit',
      } }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });

      const descriptionInput = { ...context, arguments: {
        activityRef, expectedDescription: 'Easy.', description: 'Long run.\nFelt good 🚴',
      } };
      await expect(updateMcpEventDescription(descriptionInput, codec, deps)).resolves.toEqual({
        activityRef, changed: true,
      });
      await expect(updateMcpEventDescription(descriptionInput, codec, deps))
        .resolves.toMatchObject({ changed: false });
      await expect(updateMcpEventDescription({ ...context, arguments: {
        activityRef, expectedDescription: 'Easy.', description: 'Stale edit',
      } }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
      expect((await user.collection('events').doc('event-1').get()).data()).toEqual({
        name: '  Evening ride  ', description: 'Long run.\nFelt good 🚴', tags: ['Trail'],
      });
      expect((await user.collection('activities').doc('sibling').get()).get('eventID')).toBe('event-1');
    });

    it('denies description edits without description access and any text edit to benchmarks', async () => {
      const user = db.collection('users').doc(uid);
      await user.collection('activities').doc('activity-1').set({ eventID: 'event-1' });
      await user.collection('events').doc('event-1').set({ name: 'Benchmark', description: 'Private', mergeType: 'benchmark' });
      const activityRef = `activity:${uid}:connection`;
      await expect(updateMcpEventTitle({ uid, connectionId: 'connection', grantId: 'grant-1',
        scopes: activityScopes, arguments: { activityRef, expectedTitle: 'Benchmark', title: 'Benchmark' },
      }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
      await expect(updateMcpEventDescription({ uid, connectionId: 'connection', grantId: 'grant-1',
        scopes: activityScopes, arguments: { activityRef, expectedDescription: 'Private', description: 'New' },
      }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
      await expect(updateMcpEventDescription({ uid, connectionId: 'connection', grantId: 'grant-1',
        scopes: descriptionScopes, arguments: { activityRef, expectedDescription: 'Private', description: 'Private' },
      }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
      expect((await user.collection('events').doc('event-1').get()).get('description')).toBe('Private');
    });

    it('rejects revoked grants, stale activity associations, cross-connection refs and deletion for text writes', async () => {
      const user = db.collection('users').doc(uid);
      await user.collection('activities').doc('activity-1').set({ eventID: 'event-1' });
      await user.collection('events').doc('event-1').set({ name: 'Original', description: 'Private' });
      const context = { uid, connectionId: 'connection', grantId: 'grant-1', scopes: descriptionScopes };
      const activityRef = `activity:${uid}:connection`;
      const rename = { ...context, arguments: { activityRef, expectedTitle: 'Original', title: 'New' } };
      await expect(updateMcpEventTitle({ ...context, arguments: {
        ...rename.arguments, activityRef: `activity:${uid}:other`,
      } }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
      await user.collection('activities').doc('activity-1').update({ eventID: 'event-2' });
      await expect(updateMcpEventTitle(rename, codec, deps)).rejects.toMatchObject({ code: 'detail_not_available' });
      await user.collection('activities').doc('activity-1').update({ eventID: 'event-1' });
      await user.collection('mcpConnections').doc('connection').update({ status: 'revoked', revokedAtMs: now() });
      await expect(getMcpEventTitle({ ...context, arguments: { activityRef } }, codec, deps))
        .rejects.toMatchObject({ code: 'invalid_request' });
      await expect(updateMcpEventTitle(rename, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
      await user.collection('mcpConnections').doc('connection').update({ status: 'active', revokedAtMs: null });
      await db.collection('userDeletionTombstones').doc(uid).set({ expireAt: now() + 60_000 });
      await expect(updateMcpEventDescription({ ...context, arguments: {
        activityRef, expectedDescription: 'Private', description: 'New',
      } }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
      expect((await user.collection('events').doc('event-1').get()).data()).toEqual({
        name: 'Original', description: 'Private',
      });
    });

    it.each([
      { mergeType: 'benchmark' },
      { isMerge: true },
    ])('rejects benchmark events without changing their tags: %j', async benchmarkFields => {
      const user = db.collection('users').doc(uid);
      await user.collection('activities').doc('activity-1').set({ eventID: 'event-1' });
      await user.collection('events').doc('event-1').set({
        tags: ['Benchmark'],
        ...benchmarkFields,
      });

      await expect(updateMcpEventTags({
        uid, connectionId: 'connection', grantId: 'grant-1', scopes: activityScopes,
        arguments: {
          activityRef: `activity:${uid}:connection`,
          expectedTags: ['Benchmark'],
          tags: ['Benchmark'],
        },
      }, codec, deps)).rejects.toMatchObject({
        code: 'invalid_request',
        message: 'Benchmark events cannot be changed through MCP.',
      });
      expect((await user.collection('events').doc('event-1').get()).data()?.tags)
        .toEqual(['Benchmark']);
    });

    it('creates, discovers, edits and permanently deletes a note with safe retries', async () => {
      const createInput = {
        uid, connectionId: 'connection', grantId: 'grant-1', scopes: noteScopes,
        arguments: {
          category: 'travel', title: 'Altitude camp', details: 'Arrived in the evening.',
          startDate: '2026-09-20', endDate: '2026-09-24', timeZone: 'Europe/Helsinki',
          showOnCharts: false, color: 'purple', mutationId: randomUUID(),
        },
      };
      const created = await createMcpTimelineNote(createInput, codec, deps);
      await expect(createMcpTimelineNote(createInput, codec, deps)).resolves.toEqual(created);
      await expect(createMcpTimelineNote({
        ...createInput,
        arguments: { ...createInput.arguments, title: 'Different content' },
      }, codec, deps)).rejects.toMatchObject({
        code: 'invalid_request',
        message: 'This mutationId was already used for different note content. Use a new UUID for a new note.',
      });

      const query = await queryEditableMcpTimelineNotes({
        uid, connectionId: 'connection', grantId: 'grant-1', scopes: noteScopes,
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
        uid, connectionId: 'connection', grantId: 'grant-1', scopes: noteScopes,
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
        uid, connectionId: 'connection', grantId: 'grant-1', scopes: noteScopes,
        arguments: { noteRef: created.noteRef, expectedRevision: 2 },
      }, codec, deps)).resolves.toMatchObject({ operation: 'deleted', deleted: true });
      await expect(deleteMcpTimelineNote({
        uid, connectionId: 'connection', grantId: 'grant-1', scopes: noteScopes,
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
      await user.collection('mcpConnections').doc('connection').update({ grantId: 'grant-replacement' });
      await expect(updateMcpEventTags({
        uid, connectionId: 'connection', grantId: 'grant-1', scopes: activityScopes,
        arguments: { activityRef: `activity:${uid}:connection`, expectedTags: [], tags: ['Private'] },
      }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
      expect((await user.collection('events').doc('event-1').get()).data()?.tags).toEqual([]);

      await user.collection('mcpConnections').doc('connection').update({ revokedAtMs: now(), status: 'revoked' });
      await expect(updateMcpEventTags({
        uid, connectionId: 'connection', grantId: 'grant-replacement', scopes: activityScopes,
        arguments: { activityRef: `activity:${uid}:connection`, expectedTags: [], tags: ['Private'] },
      }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });

      await user.collection('mcpConnections').doc('other').set({
        status: 'active', scopes: noteScopes, grantId: 'grant-2', createdAtMs: 2, revokedAtMs: null,
      });
      await expect(deleteMcpTimelineNote({
        uid, connectionId: 'other', grantId: 'grant-2', scopes: noteScopes,
        arguments: { noteRef: `note:${'a'.repeat(64)}:${uid}:connection`, expectedRevision: 1 },
      }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
    });

    it('binds first-party Assistant writes to the active generation, permission, and pending proposal', async () => {
      const user = db.collection('users').doc(uid);
      const conversationId = 'assistant-conversation';
      const connectionId = `first-party-assistant-v1:${conversationId}`;
      await user.collection('activities').doc('activity-1').set({ eventID: 'event-1' });
      await user.collection('events').doc('event-1').set({ tags: ['Easy'] });
      const proposalArguments = {
        activityRef: `activity:${uid}:${connectionId}`,
        expectedTags: ['Easy'], tags: ['Quality'],
      };
      await user.collection('assistantConversations').doc('active').set({
        conversationId,
        expireAt: Timestamp.fromMillis(now() + 60_000),
        activityTagChangesEnabled: true,
        timelineNotesEnabled: false,
        timelineNoteChangesEnabled: false,
        pendingContentProposal: {
          proposalRef: 'proposal-1', kind: 'update_event_tags',
          expiresAtMs: now() + 60_000, arguments: proposalArguments,
        },
      });
      const input = {
        uid, connectionId, assistantConversationId: conversationId,
        assistantProposalRef: 'proposal-1', scopes: activityScopes,
        arguments: proposalArguments,
      };
      await expect(updateMcpEventTags(input, codec, deps)).resolves.toMatchObject({ changed: true });
      await expect(updateMcpEventTags({
        ...input,
        assistantProposalRef: undefined,
        arguments: { ...input.arguments, expectedTags: ['Quality'], tags: ['Missing review'] },
      }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
      await user.collection('assistantConversations').doc('active').update({
        pendingContentProposal: {
          proposalRef: 'proposal-1', kind: 'update_event_tags',
          expiresAtMs: now() + 60_000,
          arguments: { ...proposalArguments, expectedTags: ['Quality'], tags: ['Reviewed'] },
        },
      });
      await expect(updateMcpEventTags({
        ...input,
        arguments: { ...proposalArguments, expectedTags: ['Quality'], tags: ['Different payload'] },
      }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
      await user.collection('assistantConversations').doc('active').update({
        pendingContentProposal: {
          proposalRef: 'proposal-1', kind: 'update_event_tags',
          expiresAtMs: now(), arguments: proposalArguments,
        },
      });
      await expect(updateMcpEventTags({
        ...input,
        arguments: { ...input.arguments, expectedTags: ['Quality'], tags: ['Expired'] },
      }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
      await user.collection('assistantConversations').doc('active').update({
        pendingContentProposal: {
          proposalRef: 'proposal-2', kind: 'update_event_tags',
          expiresAtMs: now() + 60_000, arguments: proposalArguments,
        },
      });
      await expect(updateMcpEventTags(input, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
      await user.collection('assistantConversations').doc('active').update({
        pendingContentProposal: {
          proposalRef: 'proposal-1', kind: 'update_event_tags',
          expiresAtMs: now() + 60_000, arguments: proposalArguments,
        },
        activityTagChangesEnabled: false,
      });
      await expect(updateMcpEventTags({
        ...input,
        arguments: { ...input.arguments, expectedTags: ['Quality'], tags: ['Blocked'] },
      }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
      expect((await user.collection('events').doc('event-1').get()).data()?.tags).toEqual(['Quality']);
    });

    it('rejects cross-owner references and fences every write during account deletion', async () => {
      const user = db.collection('users').doc(uid);
      await user.collection('activities').doc('activity-1').set({ eventID: 'event-1' });
      await user.collection('events').doc('event-1').set({ tags: ['Original'] });

      const otherUid = `mcp-content-write-${randomUUID()}`;
      users.push(otherUid);
      await db.collection('users').doc(otherUid).set({ test: true });
      await db.collection('users').doc(otherUid).collection('mcpConnections').doc('connection').set({
        status: 'active', scopes: noteScopes, grantId: 'grant-other', createdAtMs: 1, revokedAtMs: null,
      });
      await expect(deleteMcpTimelineNote({
        uid: otherUid, connectionId: 'connection', grantId: 'grant-other', scopes: noteScopes,
        arguments: { noteRef: `note:${'a'.repeat(64)}:${uid}:connection`, expectedRevision: 1 },
      }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });

      await db.collection('userDeletionTombstones').doc(uid).set({
        expireAt: now() + 60_000,
      });
      await expect(updateMcpEventTags({
        uid, connectionId: 'connection', grantId: 'grant-1', scopes: activityScopes,
        arguments: {
          activityRef: `activity:${uid}:connection`,
          expectedTags: ['Original'],
          tags: ['Changed'],
        },
      }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
      await expect(createMcpTimelineNote({
        uid, connectionId: 'connection', grantId: 'grant-1', scopes: noteScopes,
        arguments: {
          category: 'other', title: 'Blocked', startDate: '2026-09-22', endDate: '2026-09-22',
          timeZone: 'Europe/Helsinki', mutationId: randomUUID(),
        },
      }, codec, deps)).rejects.toMatchObject({ code: 'invalid_request' });
      expect((await user.collection('events').doc('event-1').get()).data()?.tags).toEqual(['Original']);
      expect((await user.collection('timelineNotes').get()).empty).toBe(true);
    });
  },
);
