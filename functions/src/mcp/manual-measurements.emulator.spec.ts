import { randomUUID } from 'node:crypto';
import { WeightUnits } from '@sports-alliance/sports-lib';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from './server';
import { createMcpDataService, encodeOpaqueValue, decodeOpaqueValue } from './data.service';
import { MCP_MANUAL_MEASUREMENT_OUTPUTS } from './manual-measurements.schemas';
import { runMcpManualMeasurement, type ManualMeasurementCodec } from './manual-measurements.service';
import type { McpContentWriteInput } from './content-write.service';
import { saveManualHealthMeasurement, deleteManualHealthMeasurement } from '../health/manual-measurements';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('manual measurement MCP real transactions', { timeout: 30000 }, () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required.');
  const db = new Firestore({ projectId: 'demo-mcp-manual-measurements' });
  const owners: string[] = [];
  const now = () => Date.parse('2026-10-01T12:00:00Z');
  let uid: string;
  const deps = { db, now };
  const codec: ManualMeasurementCodec = {
    encode: (kind, payload, owner, connection) => encodeOpaqueValue(
      kind === 'ref' ? 'manual_measurement_ref' : 'manual_measurement_cursor', payload, owner, connection),
    decode: (kind, value, owner, connection) => decodeOpaqueValue(
      kind === 'ref' ? 'manual_measurement_ref' : 'manual_measurement_cursor', value, owner, connection, 'measurement'),
  };
  const input = (args: unknown): McpContentWriteInput => ({ uid, connectionId: 'connection',
    grantId: 'grant-1', scopes: ['measurements:write'], arguments: args });
  const call = (tool: keyof typeof MCP_MANUAL_MEASUREMENT_OUTPUTS, args: unknown, override?: Partial<McpContentWriteInput>) =>
    runMcpManualMeasurement(tool, { ...input(args), ...override }, codec, deps);
  const create = (args: Record<string, unknown> = {}) => call('create_manual_measurement', {
    mutationId: randomUUID(), metricId: 'body_weight', value: 80, unit: 'kg',
    observedAt: '2026-10-01T11:00:12.123+03:00', ...args });
  const connection = () => db.doc(`users/${uid}/mcpConnections/connection`);
  const measurement = (result: unknown) => MCP_MANUAL_MEASUREMENT_OUTPUTS.get_manual_measurement.parse(result).measurement;
  beforeEach(async () => {
    vi.restoreAllMocks();
    uid = `manual-${randomUUID()}`; owners.push(uid);
    await db.doc(`users/${uid}`).set({ settings: { unitSettings: { weightUnits: WeightUnits.Pounds } } });
    await connection().set({ status: 'active', grantId: 'grant-1', createdAtMs: 1, scopes: ['measurements:write'] });
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    // Exact generated fixture owners on an explicitly loopback demo project only.
    for (const owner of owners) {
      await db.recursiveDelete(db.doc(`users/${owner}`));
      await db.doc(`userDeletionTombstones/${owner}`).delete();
    }
    await db.terminate();
  });
  it.each([
    ['body_weight', 80, 'kg', {}], ['body_fat', 20, 'percent', {}], ['muscle_mass', 40, 'kg', {}],
    ['body_water', 55, 'percent', {}], ['bone_mass', 3, 'kg', {}], ['blood_oxygen_saturation', 98, 'percent', {}],
    ['blood_pressure_systolic', 120, 'mmHg', { diastolicValue: 80, pulseValue: 60 }],
    ['vo2_max', 50, 'ml_per_kg_per_min', { vo2Context: 'running', vo2Method: 'field_test' }],
  ])('creates, finds, edits, retries and permanently deletes %s', async (metricId, value, unit, metadata) => {
    const args = { mutationId: randomUUID(), metricId, value, unit, ...metadata as object };
    const created = measurement(await create(args));
    expect(measurement(await create(args)).revision).toBe(1);
    const page = MCP_MANUAL_MEASUREMENT_OUTPUTS.query_manual_measurements.parse(await call('query_manual_measurements', { metricId }));
    expect(page.measurements).toHaveLength(1);
    expect(measurement(await call('get_manual_measurement', { measurementRef: page.measurements[0].measurementRef })).canonicalValue).toBe(value);
    const update = { measurementRef: created.measurementRef, expectedRevision: 1, value: Number(value) + 1, unit };
    const updated = measurement(await call('update_manual_measurement', update));
    expect(updated.revision).toBe(2); expect(updated.observedAt).toBe(created.observedAt);
    expect(updated.timezoneOffsetSeconds).toBe(10800);
    expect(measurement(await call('update_manual_measurement', update)).revision).toBe(2);
    await expect(call('update_manual_measurement', { ...update, value: Number(value) + 2 })).rejects.toThrow('changed');
    expect(measurement(await create(args)).revision).toBe(2);
    const remove = { measurementRef: updated.measurementRef, expectedRevision: 2 };
    expect(await call('delete_manual_measurement', remove)).toEqual({ deleted: true });
    expect(await call('delete_manual_measurement', remove)).toEqual({ deleted: false });
    await expect(create(args)).rejects.toThrow('unavailable');
    expect(JSON.stringify(updated)).not.toMatch(/sourceRecordId|accountKey|revisionDigest|userID|sourceRecordKey/);
  });
  it('uses owner units and native MCP execution end to end without mutation callables', async () => {
    const service = createMcpDataService({ manualMeasurementDependencies: deps, now } as never);
    const server = createMcpServer({ ...input({}), clientId: 'https://client.example' }, 'https://quantified-self.io', service);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'manual-test', version: '1' });
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      const catalog = await client.callTool({ name: 'list_manual_measurement_types', arguments: {} });
      expect(catalog.isError).not.toBe(true);
      const types = MCP_MANUAL_MEASUREMENT_OUTPUTS.list_manual_measurement_types.parse(catalog.structuredContent);
      expect(types.types).toHaveLength(8);
      expect(types.types[0].defaultInputUnit).toBe('lb');
      const result = await client.callTool({ name: 'create_manual_measurement', arguments: {
        mutationId: randomUUID(), metricId: 'body_weight', value: 176.36980975, unit: 'lb', observedAt: types.serverTime } });
      expect(result.isError).not.toBe(true);
      const entry = measurement(result.structuredContent);
      expect(entry.canonicalValue).toBeCloseTo(80, 5); expect(entry.displayUnit).toMatch(/lb/);
      expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(result.structuredContent);
    } finally { await client.close(); await server.close(); }
  });
  it('binds references to owner, connection and grant; read scopes never authorize writes', async () => {
    const entry = measurement(await create());
    await expect(call('get_manual_measurement', { measurementRef: entry.measurementRef }, { scopes: ['measurements:read', 'health:read'] })).rejects.toThrow('permission');
    await db.doc(`users/${uid}/mcpConnections/other`).set({ scopes: ['measurements:write'], grantId: 'grant-1' });
    await expect(call('get_manual_measurement', { measurementRef: entry.measurementRef }, { connectionId: 'other' })).rejects.toThrow('reference');
    await connection().update({ grantId: 'grant-2' });
    await expect(call('get_manual_measurement', { measurementRef: entry.measurementRef }, { grantId: 'grant-2' })).rejects.toThrow('stale');
    await expect(create()).rejects.toThrow('permission');
  });
  it('serializes concurrent duplicates and competing edits without extra entries', async () => {
    const args = { mutationId: randomUUID() };
    const entries = await Promise.all(Array.from({ length: 4 }, () => create(args)));
    expect(new Set(entries.map(entry => codec.decode('ref', measurement(entry).measurementRef, uid, 'connection').id)).size).toBe(1);
    const entry = measurement(entries[0]);
    const results = await Promise.allSettled([81, 82].map(value => call('update_manual_measurement', {
      measurementRef: entry.measurementRef, expectedRevision: 1, value, unit: 'kg' })));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await db.collection(`users/${uid}/healthSourceRecords`).get()).size).toBe(1);
  });
  it('bounds invalid-record scans and never exposes private neighboring fields', async () => {
    const entry = measurement(await create());
    const id = String(codec.decode('ref', entry.measurementRef, uid, 'connection').id);
    const doc = db.doc(`users/${uid}/healthSourceRecords/${id}`);
    await doc.update({ privateSecret: 'CANARY_PRIVATE', 'source.device': { secret: 'CANARY_DEVICE' } });
    expect(JSON.stringify(await call('get_manual_measurement', { measurementRef: entry.measurementRef }))).not.toContain('CANARY');
    const batch = db.batch();
    for (let i = 0; i < 500; i++) batch.set(db.doc(`users/${uid}/healthSourceRecords/${i.toString(16).padStart(64, '0')}`), {
      startTimeMs: now(), source: { sourceRecordType: 'manual_measurement' }, metrics: [] });
    await batch.commit();
    const page = MCP_MANUAL_MEASUREMENT_OUTPUTS.query_manual_measurements.parse(await call('query_manual_measurements', {}));
    expect(page).toMatchObject({ measurements: [], scannedCount: 500, skippedCount: 500, scanComplete: false });
    const next = MCP_MANUAL_MEASUREMENT_OUTPUTS.query_manual_measurements.parse(await call('query_manual_measurements', { cursor: page.nextCursor }));
    expect(next.measurements).toHaveLength(1); expect(next.scanComplete).toBe(true);
  });
  it('continues past malformed record identities without exposing them or losing valid entries', async () => {
    await create();
    const batch = db.batch();
    for (let i = 0; i < 500; i++) batch.set(db.doc(`users/${uid}/healthSourceRecords/${`invalid-${i}`.padEnd(128, 'x')}`), {
      startTimeMs: now(), source: { sourceRecordType: 'manual_measurement' }, metrics: [] });
    await batch.commit();
    const page = MCP_MANUAL_MEASUREMENT_OUTPUTS.query_manual_measurements.parse(await call('query_manual_measurements', {}));
    expect(page).toMatchObject({ measurements: [], scannedCount: 500, skippedCount: 500, scanComplete: false });
    expect(JSON.stringify(page)).not.toContain('invalid-');
    const next = MCP_MANUAL_MEASUREMENT_OUTPUTS.query_manual_measurements.parse(await call('query_manual_measurements', { cursor: page.nextCursor }));
    expect(next.measurements).toHaveLength(1); expect(next.scanComplete).toBe(true);
  });
  it('charges all fetched lookahead data against the selected-input byte bound', async () => {
    await create();
    const batch = db.batch();
    for (let i = 0; i < 2; i++) batch.set(db.doc(`users/${uid}/healthSourceRecords/${i.toString(16).padStart(64, '0')}`), {
      startTimeMs: now() - i, source: { sourceRecordType: 'manual_measurement' },
      metrics: [{ malformed: 'x'.repeat(700 * 1024) }] });
    await batch.commit();
    await expect(call('query_manual_measurements', { limit: 1 })).rejects.toThrow('read bound');
  });
  it('rechecks revocation before identical update and deletion retries', async () => {
    const entry = measurement(await create());
    const update = { measurementRef: entry.measurementRef, expectedRevision: 1, value: 81, unit: 'kg' };
    const updated = measurement(await call('update_manual_measurement', update));
    const original = db.runTransaction.bind(db);
    vi.spyOn(db, 'runTransaction').mockImplementationOnce(async fn => {
      await connection().update({ revokedAtMs: now() }); return original(fn);
    });
    await expect(call('update_manual_measurement', update)).rejects.toThrow('permission');
    await connection().update({ revokedAtMs: null });
    const remove = { measurementRef: updated.measurementRef, expectedRevision: 2 };
    await call('delete_manual_measurement', remove);
    vi.spyOn(db, 'runTransaction').mockImplementationOnce(async fn => {
      await connection().update({ revokedAtMs: now() }); return original(fn);
    });
    await expect(call('delete_manual_measurement', remove)).rejects.toThrow('permission');
  });
  it('checks revocation inside persistence, including no-op retries', async () => {
    const original = db.runTransaction.bind(db);
    vi.spyOn(db, 'runTransaction').mockImplementationOnce(async fn => {
      await connection().update({ revokedAtMs: now() });
      return original(fn);
    });
    await expect(create()).rejects.toThrow('permission');
    expect((await db.collection(`users/${uid}/healthSourceRecords`).get()).empty).toBe(true);
  });
  it('fences account deletion and refuses imported or malformed records', async () => {
    const entry = measurement(await create());
    const id = String(codec.decode('ref', entry.measurementRef, uid, 'connection').id);
    await db.doc(`users/${uid}/healthSourceRecords/${id}`).update({ 'source.provider': 'GarminAPI' });
    await expect(call('update_manual_measurement', { measurementRef: entry.measurementRef, expectedRevision: 1, value: 81, unit: 'kg' })).rejects.toThrow('unavailable');
    await expect(call('delete_manual_measurement', { measurementRef: entry.measurementRef, expectedRevision: 1 })).rejects.toThrow('unavailable');
    const original = db.runTransaction.bind(db);
    vi.spyOn(db, 'runTransaction').mockImplementationOnce(async fn => {
      await db.doc(`userDeletionTombstones/${uid}`).set({ expireAt: Timestamp.fromMillis(now() + 100000) });
      return original(fn);
    });
    await expect(create()).rejects.toThrow('deleted');
  });
  it('pages duplicate dates in stable newest-first order and binds filters and cursors', async () => {
    await Promise.all(Array.from({ length: 31 }, () => create()));
    const first = MCP_MANUAL_MEASUREMENT_OUTPUTS.query_manual_measurements.parse(await call('query_manual_measurements', { limit: 25 }));
    expect(first.measurements).toHaveLength(25); expect(first.scanComplete).toBe(false);
    const second = MCP_MANUAL_MEASUREMENT_OUTPUTS.query_manual_measurements.parse(await call('query_manual_measurements', { limit: 25, cursor: first.nextCursor }));
    expect(second.measurements).toHaveLength(6); expect(second.nextCursor).toBeNull();
    const ids = [...first.measurements, ...second.measurements].map(m => codec.decode('ref', m.measurementRef, uid, 'connection').id);
    expect(new Set(ids).size).toBe(31);
    await expect(call('query_manual_measurements', { limit: 10, cursor: first.nextCursor })).rejects.toThrow('changed');
    await expect(call('query_manual_measurements', { start: '2024-01-01T00:00:00Z', end: '2026-01-01T00:00:00Z' })).rejects.toThrow('366');
  });
  it('checks an exact Assistant proposal inside the same write transaction', async () => {
    const conversationId = randomUUID();
    const args = { mutationId: randomUUID(), metricId: 'body_weight', value: 80, unit: 'kg', observedAt: '2026-10-01T11:00:00+03:00' };
    const assistant = { connectionId: `first-party-assistant-v1:${conversationId}`, assistantConversationId: conversationId, assistantProposalRef: 'proposal' };
    const ref = db.doc(`users/${uid}/assistantConversations/active`);
    await ref.set({ conversationId, expireAt: Timestamp.fromMillis(now() + 100000), measurementChangesEnabled: true,
      pendingContentProposal: { kind: 'create_manual_measurement', proposalRef: 'proposal', expiresAtMs: now() + 100000, arguments: args } });
    expect(measurement(await call('create_manual_measurement', args, assistant)).revision).toBe(1);
    await ref.update({ measurementChangesEnabled: false });
    await expect(call('create_manual_measurement', args, assistant)).rejects.toThrow('no longer current');
  });
  it('returns the advertised 100-entry page including paired and VO2 metadata within response bounds', async () => {
    for (let offset = 0; offset < 100; offset += 10) await Promise.all(Array.from({ length: 10 }, (_, index) => create(
      (offset + index) % 2 ? { metricId: 'blood_pressure_systolic', value: 120, unit: 'mmHg', diastolicValue: 80, pulseValue: 60 }
        : { metricId: 'vo2_max', value: 50, unit: 'ml_per_kg_per_min', vo2Context: 'cycling', vo2Method: 'other_estimate' },
    )));
    const page = MCP_MANUAL_MEASUREMENT_OUTPUTS.query_manual_measurements.parse(await call('query_manual_measurements', { limit: 100 }));
    expect(page).toMatchObject({ scanComplete: true, nextCursor: null, scannedCount: 100, skippedCount: 0 });
    expect(page.measurements).toHaveLength(100);
    expect(Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(page) }], structuredContent: page }), 'utf8') + 1024)
      .toBeLessThanOrEqual(256 * 1024);
  });

  it('shares UI transactions and rejects stale deletes and later update replay', async () => {
    const entry = measurement(await create());
    const id = String(codec.decode('ref', entry.measurementRef, uid, 'connection').id);
    const record = await db.doc(`users/${uid}/healthSourceRecords/${id}`).get();
    const uiUpdate = { mode: 'update', sourceRecordId: id, expectedRevisionOrder: 1, metricId: 'body_weight',
      canonicalValue: 81, observedAtMs: record.data()!.startTimeMs, timezoneOffsetSeconds: 10800 };
    await saveManualHealthMeasurement(uid, uiUpdate, deps);
    await expect(call('delete_manual_measurement', { measurementRef: entry.measurementRef, expectedRevision: 1 })).rejects.toThrow('changed');
    await saveManualHealthMeasurement(uid, { ...uiUpdate, expectedRevisionOrder: 2, canonicalValue: 82 }, deps);
    await expect(saveManualHealthMeasurement(uid, uiUpdate, deps)).rejects.toThrow();
    await deleteManualHealthMeasurement(uid, { sourceRecordId: id, expectedRevisionOrder: 3 }, deps);
  });
  it('never mistakes concurrent changes to omitted fields for an identical update retry', async () => {
    const entry = measurement(await create());
    const id = String(codec.decode('ref', entry.measurementRef, uid, 'connection').id);
    await saveManualHealthMeasurement(uid, { mode: 'update', sourceRecordId: id, expectedRevisionOrder: 1,
      metricId: 'body_weight', canonicalValue: 81, observedAtMs: now() - 12345, timezoneOffsetSeconds: 0 }, deps);
    await expect(call('update_manual_measurement', { measurementRef: entry.measurementRef, expectedRevision: 1,
      value: 81, unit: 'kg' })).rejects.toThrow('changed');
  });
});
