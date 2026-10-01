import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DataWeight, WeightUnits, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { HEALTH_METRIC_CATALOG, HEALTH_METRIC_IDS, HEALTH_SOURCE_RECORDS_COLLECTION_ID,
  type HealthMetricId } from '../../../shared/health';
import { MANUAL_HEALTH_METRIC_IDS, MANUAL_HEALTH_SOURCE_RECORD_TYPE, MANUAL_VO2_CONTEXTS,
  MANUAL_VO2_METHODS, type ManualHealthMeasurementFields } from '../../../shared/manual-health';
import { formatCanonicalHealthMetricSportsLibValue } from '../../../shared/sports-lib-health-data';
import { normalizeUserUnitSettings } from '../../../shared/unit-aware-display';
import { decodeManualHealthMeasurementFields, saveManualHealthMeasurement, deleteManualHealthMeasurement,
  ManualHealthValidationError, ManualHealthRevisionConflictError, ManualHealthMeasurementNotFoundError,
  ManualHealthWriteBlockedError, validateSaveManualHealthMeasurementRequest } from '../health/manual-measurements';
import { assertInputScopes, readAccessGeneration, assertConnectionAuthorityInTransaction,
  McpContentWriteError, type McpContentWriteInput } from './content-write.service';
import { MCP_MANUAL_MEASUREMENT_INPUTS, MCP_MANUAL_MEASUREMENT_OUTPUTS, MCP_MANUAL_MEASUREMENT_UNITS,
  MCP_MANUAL_MEASUREMENTS_SCOPE, type McpManualMeasurementTool,
  type McpManualMeasurementWriteTool } from './manual-measurements.schemas';

export interface ManualMeasurementCodec {
  encode(kind: 'ref' | 'cursor', payload: Record<string, unknown>, uid: string, connectionId: string): string;
  decode(kind: 'ref' | 'cursor', value: string, uid: string, connectionId: string): Record<string, unknown>;
}
export interface ManualMeasurementDependencies { db: admin.firestore.Firestore; now(): number }
export const defaultManualMeasurementDependencies = (): ManualMeasurementDependencies => ({ db: admin.firestore(), now: Date.now });
const scopes = [MCP_MANUAL_MEASUREMENTS_SCOPE];
export const MANUAL_MEASUREMENT_FIELD_MASK = [
  'schemaVersion', 'id', 'userID', 'kind', 'source.provider', 'source.sourceRecordType',
  'source.accountKey', 'source.sourceRecordKey', 'source.revision.order', 'source.revision.token',
  'source.revision.digest', 'sampleChunkIds', 'metricIds', 'metrics', 'startTimeMs', 'endTimeMs',
  'timezoneOffsetSeconds',
] as const;
const identity = z.strictObject({ id: z.string().regex(/^[a-f0-9]{64}$/), generation: z.string().length(64) });
// Seal the pre-edit defaults in the reference: merging omitted fields from a newer
// record could otherwise mistake a concurrent edit for an identical retry.
const reference = identity.extend({ revision: z.number().int().positive().safe(),
  defaults: z.tuple([z.number().int().safe(), z.number().int().min(-86399).max(86399),
    z.number().positive().nullable(), z.number().positive().nullable(),
    z.enum(MANUAL_VO2_CONTEXTS).nullable(), z.enum(MANUAL_VO2_METHODS).nullable()]),
});
// Scan positions can belong to malformed records that were deliberately skipped.
// Do not require their IDs to be valid measurement identities. Keep the private
// cursor bounded so the encrypted value still fits its public 512-character cap.
const cursorSchema = z.strictObject({ id: z.string().min(1).max(128)
  .refine(id => Buffer.byteLength(JSON.stringify(id), 'utf8') <= 130), generation: z.string().length(64),
  query: z.string().length(64), time: z.number().int().safe(), expires: z.number().int().safe() });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function invalid(message: string): never { throw new McpContentWriteError('invalid_request', message); }
function unavailable(): never { throw new McpContentWriteError('detail_not_available', 'This manual measurement is unavailable. Find a current manual entry before editing. Imported entries cannot be managed here.'); }
const collection = (deps: ManualMeasurementDependencies, uid: string) => deps.db.collection('users').doc(uid).collection(HEALTH_SOURCE_RECORDS_COLLECTION_ID);
async function readRecord(deps: ManualMeasurementDependencies, uid: string, id: string) {
  const [snapshot] = await deps.db.getAll(collection(deps, uid).doc(id), { fieldMask: [...MANUAL_MEASUREMENT_FIELD_MASK] });
  const data = snapshot.exists ? snapshot.data() : undefined;
  if (data && Buffer.byteLength(JSON.stringify(data), 'utf8') > 32 * 1024) unavailable();
  const fields = decodeManualHealthMeasurementFields(data, uid, id, deps.now());
  if (!fields || !data) unavailable();
  return { fields, revision: data.source.revision.order as number };
}
function decodeRef(codec: ManualMeasurementCodec, input: McpContentWriteInput, value: string, generation: string) {
  try {
    const decoded = reference.parse(codec.decode('ref', value, input.uid, input.connectionId));
    if (decoded.generation !== generation) invalid('The measurement permission changed. Find the entry again.');
    return decoded;
  } catch { return invalid('The manual measurement reference is invalid or stale. Find the entry again.'); }
}
function observation(value: string) {
  const observedAtMs = Date.parse(value);
  const suffix = value.match(/(Z|([+-])(\d{2}):(\d{2}))$/)!;
  const timezoneOffsetSeconds = suffix[1] === 'Z' ? 0
    : (suffix[2] === '-' ? -1 : 1) * (Number(suffix[3]) * 3600 + Number(suffix[4]) * 60);
  return { observedAtMs, timezoneOffsetSeconds };
}
function referenceFields(current: ManualHealthMeasurementFields, ref: z.infer<typeof reference>): ManualHealthMeasurementFields {
  const [observedAtMs, timezoneOffsetSeconds, diastolicValue, pulseValue, vo2Context, vo2Method] = ref.defaults;
  return { metricId: current.metricId, canonicalValue: current.canonicalValue, observedAtMs, timezoneOffsetSeconds,
    ...(diastolicValue !== null ? { diastolicValue } : {}), ...(pulseValue !== null ? { pulseValue } : {}),
    ...(vo2Context !== null ? { vo2Context } : {}), ...(vo2Method !== null ? { vo2Method } : {}) };
}
export function resolveManualMeasurementFields(
  args: z.infer<typeof MCP_MANUAL_MEASUREMENT_INPUTS.create_manual_measurement>
    | z.infer<typeof MCP_MANUAL_MEASUREMENT_INPUTS.update_manual_measurement>,
  nowMs: number, existing?: ManualHealthMeasurementFields,
): ManualHealthMeasurementFields {
  const metricId = 'metricId' in args ? args.metricId : existing?.metricId;
  if (!metricId || !(MCP_MANUAL_MEASUREMENT_UNITS[metricId] as readonly string[]).includes(args.unit)) {
    invalid('Use a supported explicit unit from list_manual_measurement_types.');
  }
  if ((metricId !== HEALTH_METRIC_IDS.BloodPressureSystolic
    && (args.diastolicValue !== undefined || args.pulseValue !== undefined))
    || (metricId !== HEALTH_METRIC_IDS.Vo2Max && (args.vo2Context !== undefined || args.vo2Method !== undefined))) {
    invalid('Paired readings apply only to blood pressure; context and method apply only to VO2 max.');
  }
  const canonicalValue = metricId === HEALTH_METRIC_IDS.BodyWeight
    ? DataWeight.fromDisplayValue(args.value, args.unit === 'lb' ? WeightUnits.Pounds : WeightUnits.Kilograms).getValue()
    : args.value;
  const merged = {
    ...existing, metricId, canonicalValue,
    ...(args.observedAt ? observation(args.observedAt) : {}),
    ...(args.diastolicValue !== undefined ? { diastolicValue: args.diastolicValue } : {}),
    ...(args.pulseValue !== undefined ? { pulseValue: args.pulseValue } : {}),
    ...(args.vo2Context !== undefined ? { vo2Context: args.vo2Context } : {}),
    ...(args.vo2Method !== undefined ? { vo2Method: args.vo2Method } : {}),
  };
  // Null explicitly clears the optional pulse; no other reading is nullable.
  const { pulseValue, ...withoutPulse } = merged;
  const validated = validateSaveManualHealthMeasurementRequest({
    mode: 'create', clientMutationId: '00000000-0000-4000-8000-000000000000',
    ...withoutPulse, ...(pulseValue != null ? { pulseValue } : {}),
  }, nowMs);
  const checked = validated as Extract<typeof validated, { mode: 'create' }>;
  return { metricId: checked.metricId, canonicalValue: checked.canonicalValue,
    observedAtMs: checked.observedAtMs, timezoneOffsetSeconds: checked.timezoneOffsetSeconds,
    ...(checked.diastolicValue !== undefined ? { diastolicValue: checked.diastolicValue } : {}),
    ...(checked.pulseValue !== undefined ? { pulseValue: checked.pulseValue } : {}),
    ...(checked.vo2Context !== undefined ? { vo2Context: checked.vo2Context } : {}),
    ...(checked.vo2Method !== undefined ? { vo2Method: checked.vo2Method } : {}) };
}
function observedIso(fields: ManualHealthMeasurementFields): string {
  // Manual offsets may include seconds historically. Preserve the exact instant
  // separately from the offset instead of inventing an IANA zone or rounding it.
  return new Date(fields.observedAtMs).toISOString();
}
function scalar(id: HealthMetricId, value: number, units?: UserUnitSettingsInterface) {
  const display = formatCanonicalHealthMetricSportsLibValue(id, value, units);
  if (!display) unavailable();
  return { canonicalValue: value, canonicalUnit: HEALTH_METRIC_CATALOG[id].canonicalUnit,
    displayValue: display.value, displayUnit: display.unit };
}
function project(fields: ManualHealthMeasurementFields, revision: number, measurementRef: string,
  units?: UserUnitSettingsInterface) {
  return { measurementRef, revision, metricId: fields.metricId, ...scalar(fields.metricId, fields.canonicalValue, units),
    observedAt: observedIso(fields), timezoneOffsetSeconds: fields.timezoneOffsetSeconds,
    diastolic: fields.diastolicValue !== undefined ? scalar(HEALTH_METRIC_IDS.BloodPressureDiastolic, fields.diastolicValue, units) : null,
    pulse: fields.pulseValue !== undefined ? scalar(HEALTH_METRIC_IDS.PulseRate, fields.pulseValue, units) : null,
    vo2Context: fields.vo2Context ?? null, vo2Method: fields.vo2Method ?? null };
}
export async function runMcpManualMeasurement(
  tool: McpManualMeasurementTool, input: McpContentWriteInput, codec: ManualMeasurementCodec,
  deps = defaultManualMeasurementDependencies(),
): Promise<Record<string, unknown>> {
  try {
    assertInputScopes(input, scopes);
    const parsed = MCP_MANUAL_MEASUREMENT_INPUTS[tool].safeParse(input.arguments);
    if (!parsed.success) invalid('Review the advertised manual measurement schema and correct the input.');
    const generation = hash(await readAccessGeneration(deps, input, scopes));
    const [user] = await deps.db.getAll(deps.db.collection('users').doc(input.uid), { fieldMask: ['settings.unitSettings'] });
    const units = user.data()?.settings?.unitSettings as UserUnitSettingsInterface | undefined;
    const refFor = (id: string, fields: ManualHealthMeasurementFields, revision: number) => codec.encode('ref', {
      id, generation, revision, defaults: [fields.observedAtMs, fields.timezoneOffsetSeconds,
        fields.diastolicValue ?? null, fields.pulseValue ?? null, fields.vo2Context ?? null, fields.vo2Method ?? null],
    }, input.uid, input.connectionId);
    let result: unknown;
    switch (tool) {
      case 'list_manual_measurement_types':
        result = { serverTime: new Date(deps.now()).toISOString(), types: MANUAL_HEALTH_METRIC_IDS.map(metricId => ({
          metricId, label: HEALTH_METRIC_CATALOG[metricId].label,
          canonicalUnit: HEALTH_METRIC_CATALOG[metricId].canonicalUnit,
          inputUnits: [...MCP_MANUAL_MEASUREMENT_UNITS[metricId]],
          defaultInputUnit: metricId === HEALTH_METRIC_IDS.BodyWeight && normalizeUserUnitSettings(units).weightUnits === WeightUnits.Pounds
            ? 'lb' : MCP_MANUAL_MEASUREMENT_UNITS[metricId][0],
          requiresDiastolic: metricId === HEALTH_METRIC_IDS.BloodPressureSystolic,
          vo2Contexts: metricId === HEALTH_METRIC_IDS.Vo2Max ? [...MANUAL_VO2_CONTEXTS] : [],
          vo2Methods: metricId === HEALTH_METRIC_IDS.Vo2Max ? [...MANUAL_VO2_METHODS] : [],
        })) };
        break;
      case 'query_manual_measurements': {
        const args = MCP_MANUAL_MEASUREMENT_INPUTS.query_manual_measurements.parse(input.arguments);
        if ((args.start === undefined) !== (args.end === undefined)
          || (args.start && args.end && (Date.parse(args.end) < Date.parse(args.start)
            || Date.parse(args.end) - Date.parse(args.start) > 366 * 86_400_000))) {
          invalid('Provide both start and end instants, in order, within 366 days; or omit both for recent entries.');
        }
        const queryDigest = hash(JSON.stringify([args.metricId ?? null, args.start ?? null, args.end ?? null, args.limit]));
        let position: z.infer<typeof cursorSchema> | null = null;
        if (args.cursor) {
          try { position = cursorSchema.parse(codec.decode('cursor', args.cursor, input.uid, input.connectionId)); }
          catch { invalid('The measurement cursor is invalid. Restart the query.'); }
          if (position.generation !== generation || position.query !== queryDigest || position.expires <= deps.now()) {
            invalid('The query or permission changed, or the cursor expired. Restart the query.');
          }
        }
        const measurements: ReturnType<typeof project>[] = [];
        let scannedCount = 0, skippedCount = 0, selectedBytes = 0, more = true;
        while (more && measurements.length < args.limit && scannedCount < 500) {
          const pageSize = Math.min(25, args.limit - measurements.length, 500 - scannedCount);
          let query = collection(deps, input.uid).where('source.sourceRecordType', '==', MANUAL_HEALTH_SOURCE_RECORD_TYPE)
            .orderBy('startTimeMs', 'desc').orderBy(FieldPath.documentId(), 'desc').select(...MANUAL_MEASUREMENT_FIELD_MASK);
          if (args.metricId) query = query.where('metricIds', 'array-contains', args.metricId);
          if (args.start && args.end) query = query.where('startTimeMs', '>=', Date.parse(args.start)).where('startTimeMs', '<=', Date.parse(args.end));
          if (position) query = query.startAfter(position.time, position.id);
          const page = (await query.limit(pageSize + 1).get()).docs;
          // Charge every fetched record, including lookahead and repeated reads,
          // before deciding which records are consumed or returned.
          const records = page.map(doc => {
            const data = doc.data();
            const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
            selectedBytes += bytes;
            if (selectedBytes > 2 * 1024 * 1024) invalid('This page exceeds the measurement read bound. Narrow the range or reduce limit.');
            return { doc, data, bytes };
          });
          more = page.length > pageSize;
          for (const { doc, data, bytes } of records.slice(0, pageSize)) {
            scannedCount++;
            position = { id: doc.id, time: data.startTimeMs, generation, query: queryDigest, expires: deps.now() + 30 * 60_000 };
            const fields = bytes <= 32 * 1024
              ? decodeManualHealthMeasurementFields(data, input.uid, doc.id, deps.now()) : null;
            if (!fields) { skippedCount++; continue; }
            measurements.push(project(fields, data.source.revision.order, refFor(doc.id, fields, data.source.revision.order), units));
          }
        }
        result = { measurements, nextCursor: more && position
          ? codec.encode('cursor', cursorSchema.parse(position), input.uid, input.connectionId) : null,
        scanComplete: !more, scannedCount, skippedCount };
        break;
      }
      case 'get_manual_measurement': {
        const args = MCP_MANUAL_MEASUREMENT_INPUTS.get_manual_measurement.parse(input.arguments);
        const ref = decodeRef(codec, input, args.measurementRef, generation);
        const current = await readRecord(deps, input.uid, ref.id);
        result = { measurement: project(current.fields, current.revision,
          ref.revision === current.revision ? args.measurementRef : refFor(ref.id, current.fields, current.revision), units) };
        break;
      }
      default: {
        if (input.assistantConversationId && !input.assistantProposalRef) invalid('Review and confirm this measurement change in QS first.');
        const transactionPrecondition = (transaction: admin.firestore.Transaction) =>
          assertConnectionAuthorityInTransaction(deps, transaction, input, scopes, tool as McpManualMeasurementWriteTool);
        const writeDeps = { ...deps, transactionPrecondition };
        if (tool === 'delete_manual_measurement') {
          const args = MCP_MANUAL_MEASUREMENT_INPUTS.delete_manual_measurement.parse(input.arguments);
          const ref = decodeRef(codec, input, args.measurementRef, generation);
          if (ref.revision !== args.expectedRevision) invalid('The measurement changed. Get its current reference and revision before reviewing again.');
          result = await deleteManualHealthMeasurement(input.uid,
            { sourceRecordId: ref.id, expectedRevisionOrder: args.expectedRevision }, writeDeps);
          break;
        }
        const args = tool === 'create_manual_measurement'
          ? MCP_MANUAL_MEASUREMENT_INPUTS.create_manual_measurement.parse(input.arguments)
          : MCP_MANUAL_MEASUREMENT_INPUTS.update_manual_measurement.parse(input.arguments);
        const ref = 'measurementRef' in args ? decodeRef(codec, input, args.measurementRef, generation) : null;
        if (ref && 'expectedRevision' in args && ref.revision !== args.expectedRevision) invalid('The measurement changed. Get its current reference and revision before reviewing again.');
        const current = ref ? await readRecord(deps, input.uid, ref.id) : null;
        const fields = resolveManualMeasurementFields(args, deps.now(), current && ref ? referenceFields(current.fields, ref) : undefined);
        const saved = await saveManualHealthMeasurement(input.uid, 'mutationId' in args
          ? { mode: 'create', clientMutationId: args.mutationId, ...fields }
          : { mode: 'update', sourceRecordId: ref!.id, expectedRevisionOrder: args.expectedRevision, ...fields }, writeDeps);
        // Return current persisted data, not an obsolete creation receipt after later edits.
        const accepted = await readRecord(deps, input.uid, saved.sourceRecordId);
        result = { measurement: project(accepted.fields, accepted.revision, refFor(saved.sourceRecordId, accepted.fields, accepted.revision), units) };
      }
    }
    if (hash(await readAccessGeneration(deps, input, scopes)) !== generation) invalid('Measurement access changed. Reauthorize and read current state.');
    const validated = MCP_MANUAL_MEASUREMENT_OUTPUTS[tool].parse(result);
    // Both structuredContent and JSON text are serialized by the MCP wrapper.
    const serialized = JSON.stringify(validated);
    const resultBytes = Buffer.byteLength(JSON.stringify({
      content: [{ type: 'text', text: serialized }], structuredContent: validated,
    }), 'utf8') + 1024;
    if (resultBytes > 256 * 1024) invalid('This measurement result is too large. Reduce limit or narrow the range.');
    return validated;
  } catch (error) {
    if (error instanceof McpContentWriteError) throw error;
    if (error instanceof ManualHealthValidationError) invalid(error.message);
    if (error instanceof ManualHealthRevisionConflictError) invalid('The manual measurement changed, or the mutation ID was reused. Read current state and review again.');
    if (error instanceof ManualHealthMeasurementNotFoundError) unavailable();
    if (error instanceof ManualHealthWriteBlockedError) invalid('This account is unavailable or being deleted.');
    throw new McpContentWriteError('temporarily_unavailable', 'The manual measurement request could not complete safely. Do not change mutation IDs on retries.');
  }
}
