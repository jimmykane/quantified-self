import { createHash } from 'node:crypto';
import { FitEncoder } from 'fit-file-parser';
import type { Firestore } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { doesSuuntoHealthWebhookBindingMatch, getSuuntoHealthWebhookAccountBindingRef, parseSuuntoHealthWebhookAccountBinding } from './health-webhook-binding';
import { isServiceDisconnectPendingData } from '../service-disconnect-pending-state';

export interface SuuntoGuideCompletion { sessionIndex: number; startTimeSeconds: number | null; externalIds: string[]; }
interface Field { number: number; size: number; type: number; }
interface Definition { global: number; little: boolean; fields: Field[]; developers: Field[]; }
const OWNER = 'suuntoplus_plugin_owner_id'; const EXTERNAL = 'suuntoplus_plugin_external_id';
const EXPORTER = Buffer.from('SuuntoFitExport1');

/** QS-only metadata reader. The activity parser flattens NUL-separated string
 * arrays. Walk FIT definitions without decoding samples or changing Sports Lib.
 * Malformed optional metadata never prevents an otherwise valid activity import. */
export function readSuuntoGuideCompletions(bytes: Buffer, clientId: string): SuuntoGuideCompletion[] {
  try {
    if (!clientId || bytes.length < 14 || bytes.length > 64 * 1024 * 1024 || bytes.toString('ascii', 8, 12) !== '.FIT') return [];
    const header = bytes[0]; const end = header + bytes.readUInt32LE(4);
    if (![12, 14].includes(header) || end + 2 !== bytes.length || FitEncoder.calculateCRC(bytes.subarray(0, end)) !== bytes.readUInt16LE(end)) return [];
    const definitions = new Map<number, Definition>(); const exporters = new Map<number, boolean>();
    const descriptions = new Map<string, string>(); const results: SuuntoGuideCompletion[] = [];
    let cursor = header; let sessionIndex = 0;
    const take = (size: number) => { if (size < 0 || cursor + size > end) throw new Error(); const value = bytes.subarray(cursor, cursor + size); cursor += size; return value; };
    const text = (value?: Buffer) => value ? new TextDecoder('utf-8', { fatal: true }).decode(value).replace(/\0+$/, '') : '';
    while (cursor < end) {
      const record = take(1)[0]; const compressed = !!(record & 0x80); const local = compressed ? (record >> 5) & 3 : record & 15;
      if (!compressed && record & 0x40) {
        const base = take(5); if (base[1] > 1) throw new Error();
        const little = base[1] === 0; const global = little ? base.readUInt16LE(2) : base.readUInt16BE(2);
        const fields: Field[] = []; const developers: Field[] = [];
        for (let n = 0; n < base[4]; n++) { const f = take(3); fields.push({ number: f[0], size: f[1], type: f[2] }); }
        if (record & 0x20) { const count = take(1)[0]; for (let n = 0; n < count; n++) { const f = take(3); developers.push({ number: f[0], size: f[1], type: f[2] }); } }
        definitions.set(local, { global, little, fields, developers }); continue;
      }
      const def = definitions.get(local); if (!def) throw new Error();
      const values = new Map<number, Buffer>();
      for (const field of def.fields) {
        if (compressed && field.number === 253 && field.size === 4) continue;
        const raw = take(field.size);
        if ([18, 206, 207].includes(def.global)) values.set(field.number, raw);
      }
      const developerValues = new Map<string, Buffer>();
      for (const field of def.developers) {
        const raw = take(field.size); const name = descriptions.get(`${field.type}:${field.number}`);
        if (def.global === 18 && exporters.get(field.type) && (name === OWNER || name === EXTERNAL)) {
          if (developerValues.has(name)) throw new Error(); developerValues.set(name, raw);
        }
      }
      if (def.global === 207) {
        const index = values.get(3)?.[0]; if (index !== undefined) exporters.set(index, !!values.get(1)?.equals(EXPORTER));
      } else if (def.global === 206) {
        const index = values.get(0)?.[0]; const number = values.get(1)?.[0]; const type = values.get(2)?.[0];
        if (index !== undefined && number !== undefined) descriptions.set(`${index}:${number}`, type === 7 ? text(values.get(3)) : '');
      } else if (def.global === 18) {
        const owners = text(developerValues.get(OWNER)).split('\0'); const ids = text(developerValues.get(EXTERNAL)).split('\0');
        const valid = (list: string[]) => list.length <= 10 && list.every(value => value.length > 0 && value.length <= 64
          && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character === '\ufffd'));
        if (owners.length === ids.length && valid(owners) && valid(ids)) {
          const externalIds = [...new Set(ids.filter((id, index) => owners[index] === clientId && /^qs-suunto-[A-Za-z0-9_-]{43}$/.test(id)))];
          const start = values.get(2); const seconds = start?.length === 4 ? def.little ? start.readUInt32LE() : start.readUInt32BE() : null;
          if (externalIds.length) results.push({ sessionIndex, startTimeSeconds: seconds === 0xffffffff ? null : seconds, externalIds });
        }
        sessionIndex++;
        if (sessionIndex > 100) throw new Error();
      }
    }
    return results;
  } catch { return []; }
}

/** Permanent leaf under its event: no descendants, browser access, matching or consent changes. */
export async function retainSuuntoGuideCompletions(db: Firestore, uid: string, eventId: string, account: string,
  tokenGeneration: string, bytes: Buffer, clientId: string): Promise<void> {
  const sessions = readSuuntoGuideCompletions(bytes, clientId); if (!sessions.length) return;
  const user = db.collection('users').doc(uid); const event = user.collection('events').doc(eventId);
  await db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return;
    const root = db.collection('suuntoAppAccessTokens').doc(uid);
    const [eventDoc, tokenDoc, rootDoc, metaDoc, bindingDoc] = await Promise.all([
      tx.get(event), tx.get(root.collection('tokens').doc(account)), tx.get(root), tx.get(user.collection('meta').doc(ServiceNames.SuuntoApp)),
      tx.get(getSuuntoHealthWebhookAccountBindingRef(db, account, uid)),
    ]);
    if (!eventDoc.exists || !rootDoc.exists || rootDoc.data()?.disconnectOperationGeneration || isServiceDisconnectPendingData(rootDoc.data())
      || metaDoc.data()?.connectionState !== 'connected' || tokenDoc.data()?.userName !== account
      || tokenDoc.data()?.tokenCredentialGeneration !== tokenGeneration
      || !doesSuuntoHealthWebhookBindingMatch(parseSuuntoHealthWebhookAccountBinding(bindingDoc.data()), uid, account, tokenGeneration)) return;
    tx.set(event.collection('trainingCompletionEvidence').doc('suunto'), { schemaVersion: 1, provider: 'suunto',
      accountDigest: createHash('sha256').update(account).digest('hex'), sessions });
  });
}
