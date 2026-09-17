import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import {
  DataFITTrainingFileReferences,
  DataFITWorkoutDefinitions,
  DataSuuntoPlusGuideReferences,
  readFITWorkoutReferences,
  type FITTrainingFileReference,
  type FITWorkoutDefinition,
  type FITWorkoutReferenceDiagnostic,
  type FITWorkoutReferenceSession,
  type SuuntoPlusGuideReference,
} from '@sports-alliance/sports-lib';
import { SPORTS_LIB_VERSION } from '../../shared/sports-lib-version.node';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { readTrainingDeliveryAuthority } from '../delivery/connection';

const MAX_PERSISTED_REFERENCES = 100;

export type QSFITWorkoutReferenceDiagnostic = FITWorkoutReferenceDiagnostic | 'qs_storage_limit';

export interface FITWorkoutReferenceEvidence {
  status: 'ok' | 'partial' | 'invalid';
  diagnostics: QSFITWorkoutReferenceDiagnostic[];
  trainingFiles: FITTrainingFileReference[];
  workouts: FITWorkoutDefinition[];
  suuntoGuides: SuuntoPlusGuideReference[];
  sessions: FITWorkoutReferenceSession[];
}

export interface PersistedFITWorkoutReferenceEvidence {
  status: FITWorkoutReferenceEvidence['status'];
  diagnostics: QSFITWorkoutReferenceDiagnostic[];
  trainingFiles: ReturnType<DataFITTrainingFileReferences['toJSON']>;
  workouts: ReturnType<DataFITWorkoutDefinitions['toJSON']>;
  suuntoGuides: ReturnType<DataSuuntoPlusGuideReferences['toJSON']>;
  sessions: FITWorkoutReferenceSession[];
}

function ownedCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Sports Lib owns FIT framing, CRC, base-type, definition and developer-field
 * parsing. This QS projection adds only a bounded Firestore persistence limit. */
export function readFITWorkoutReferenceEvidence(input: ArrayBuffer | Uint8Array): FITWorkoutReferenceEvidence {
  try {
    const result = readFITWorkoutReferences(input);
    const trainingFiles = DataFITTrainingFileReferences.fromJSON(result.trainingFiles.toJSON()).getValue().references;
    const workouts = DataFITWorkoutDefinitions.fromJSON(result.workouts.toJSON()).getValue().definitions;
    const suuntoGuides = DataSuuntoPlusGuideReferences.fromJSON(result.suuntoGuides.toJSON()).getValue().references;
    const overLimit = [trainingFiles.length, workouts.length, suuntoGuides.length, result.sessions.length]
      .some(length => length > MAX_PERSISTED_REFERENCES);
    return {
      status: overLimit && result.status !== 'invalid' ? 'partial' : result.status,
      diagnostics: [...result.diagnostics, ...(overLimit ? ['qs_storage_limit' as const] : [])],
      trainingFiles: overLimit ? [] : ownedCopy(trainingFiles),
      workouts: overLimit ? [] : ownedCopy(workouts),
      suuntoGuides: overLimit ? [] : ownedCopy(suuntoGuides),
      sessions: overLimit ? [] : ownedCopy(result.sessions),
    };
  } catch {
    return { status: 'invalid', diagnostics: ['invalid_input'], trainingFiles: [], workouts: [], suuntoGuides: [], sessions: [] };
  }
}

export function fitWorkoutEvidencePayload(
  evidence: FITWorkoutReferenceEvidence,
  suuntoGuides = evidence.suuntoGuides,
): PersistedFITWorkoutReferenceEvidence {
  return {
    status: evidence.status,
    diagnostics: evidence.diagnostics,
    trainingFiles: new DataFITTrainingFileReferences({ references: evidence.trainingFiles }).toJSON(),
    workouts: new DataFITWorkoutDefinitions({ definitions: evidence.workouts }).toJSON(),
    suuntoGuides: new DataSuuntoPlusGuideReferences({ references: suuntoGuides }).toJSON(),
    sessions: evidence.sessions,
  };
}

/** Garmin message 72 is retained as candidate evidence only. Its serial number
 * is not documented as a Training API workout or schedule identifier. */
export async function retainGarminFITWorkoutReferences(
  db: Firestore,
  uid: string,
  eventId: string,
  account: string,
  tokenGeneration: string,
  input: ArrayBuffer | Uint8Array,
  nowMs = Date.now(),
): Promise<boolean> {
  const evidence = readFITWorkoutReferenceEvidence(input);
  if (evidence.status === 'invalid' || (!evidence.trainingFiles.length && !evidence.workouts.length)) return false;
  const user = db.collection('users').doc(uid);
  const eventRef = user.collection('events').doc(eventId);
  return db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return false;
    const authority = await readTrainingDeliveryAuthority(db, tx, uid, 'garmin');
    const eventDoc = await tx.get(eventRef);
    if (!eventDoc.exists || authority.connection.state !== 'connected' || authority.account !== account
      || authority.token?.data().tokenCredentialGeneration !== tokenGeneration) return false;
    tx.set(eventRef.collection('trainingCompletionEvidence').doc('fit'), {
      schemaVersion: 1,
      reader: 'sports-lib',
      sportsLibVersion: SPORTS_LIB_VERSION,
      sourceProvider: 'garmin',
      accountDigest: createHash('sha256').update(account).digest('hex'),
      correlationState: 'candidate_only',
      ...fitWorkoutEvidencePayload(evidence, []),
      capturedAtMs: nowMs,
    });
    return true;
  });
}
