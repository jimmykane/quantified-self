import * as admin from 'firebase-admin';
import { ServiceNames, WahooAPIAuth2ServiceTokenInterface } from '@sports-alliance/sports-lib';

import { getWahooWorkoutTypeById } from '../../../shared/wahoo-activity-types';
import { isServiceDisconnectPendingForUser } from '../service-disconnect-pending';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
import { getTokenData } from '../tokens';
import { requestWahooAPI } from '../wahoo/auth/api';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from '../wahoo/constants';

const APPLY_CONFIRMATION = 'UPDATE_WAHOO_WORKOUT_TYPES';
const WORKOUT_ID_PATTERN = /^\d{1,20}$/;

interface ScriptOptions {
  uid: string;
  workoutIds: string[];
  expectedWorkoutTypeId: number;
  apply: boolean;
  confirmation?: string;
}

interface WahooWorkoutPayload {
  id?: unknown;
  name?: unknown;
  workout_type_id?: unknown;
  workout_type?: {
    id?: unknown;
    name?: unknown;
  };
}

function optionValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

function parseOptions(): ScriptOptions {
  const uid = `${optionValue('uid') || ''}`.trim();
  const workoutIds = `${optionValue('workout-ids') || ''}`
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const expectedWorkoutTypeId = Number(optionValue('expected-type-id'));
  const apply = process.argv.slice(2).includes('--apply');
  const confirmation = optionValue('confirm');

  if (!uid) throw new Error('Missing --uid=<firebase-uid>.');
  if (workoutIds.length === 0 || workoutIds.some(id => !WORKOUT_ID_PATTERN.test(id))) {
    throw new Error('Provide numeric Wahoo IDs with --workout-ids=<id,id>.');
  }
  if (!getWahooWorkoutTypeById(expectedWorkoutTypeId)) {
    throw new Error('Provide an explicitly mapped numeric ID with --expected-type-id=<id>.');
  }
  if (apply && confirmation !== APPLY_CONFIRMATION) {
    throw new Error(`Apply mode requires --confirm=${APPLY_CONFIRMATION}.`);
  }
  return { uid, workoutIds, expectedWorkoutTypeId, apply, confirmation };
}

interface SafeWorkoutSummary {
  id: string | null;
  name: string | null;
  workoutTypeId: number | null;
  workoutTypeName: string | null;
}

function safeWorkoutSummary(payload: WahooWorkoutPayload): SafeWorkoutSummary {
  const rawWorkoutTypeId = payload.workout_type_id ?? payload.workout_type?.id;
  const normalizedWorkoutTypeId = `${rawWorkoutTypeId ?? ''}`.trim();
  const workoutTypeId = normalizedWorkoutTypeId ? Number(normalizedWorkoutTypeId) : Number.NaN;
  return {
    id: `${payload.id ?? ''}` || null,
    name: `${payload.name ?? ''}` || null,
    workoutTypeId: Number.isFinite(workoutTypeId) ? workoutTypeId : null,
    workoutTypeName: `${payload.workout_type?.name ?? ''}` || null,
  };
}

export async function assertWahooCorrectionMutationAllowed(uid: string): Promise<void> {
  const deletionGuard = await getUserDeletionGuardState(admin.firestore(), uid);
  if (deletionGuard.shouldSkip) {
    throw new Error(`Cannot update Wahoo workouts for deleted or deleting user ${uid}.`);
  }
  if (await isServiceDisconnectPendingForUser(uid, ServiceNames.WahooAPI)) {
    throw new Error(`Cannot update Wahoo workouts while Wahoo disconnect is pending for user ${uid}.`);
  }
}

export function assertWahooCorrectionApplied(
  workoutId: string,
  summary: SafeWorkoutSummary,
  expectedWorkoutType: { id: number; name: string },
): void {
  if (summary.workoutTypeId !== expectedWorkoutType.id) {
    throw new Error(
      `Wahoo workout ${workoutId} did not retain the requested type after update.`,
    );
  }
}

export function buildWahooWorkoutTypeUpdateForm(workoutTypeId: number): URLSearchParams {
  const form = new URLSearchParams();
  form.set('workout[workout_type_id]', `${workoutTypeId}`);
  return form;
}

async function getAccessToken(uid: string): Promise<string> {
  const deletionGuard = await getUserDeletionGuardState(admin.firestore(), uid);
  if (deletionGuard.shouldSkip) {
    throw new Error(`Cannot inspect Wahoo workouts for deleted or deleting user ${uid}.`);
  }
  const tokenSnapshot = (await admin.firestore()
    .collection(WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME)
    .doc(uid)
    .collection('tokens')
    .limit(1)
    .get()).docs[0];
  if (!tokenSnapshot) {
    throw new Error(`No Wahoo token exists for user ${uid}.`);
  }
  const token = (await getTokenData(
    tokenSnapshot,
    ServiceNames.WahooAPI,
    false,
  )) as WahooAPIAuth2ServiceTokenInterface;
  return token.accessToken;
}

export async function runWahooWorkoutTypeCorrectionScript(): Promise<void> {
  const options = parseOptions();
  if (admin.apps.length === 0) admin.initializeApp();
  const accessToken = await getAccessToken(options.uid);
  const expectedWorkoutType = getWahooWorkoutTypeById(options.expectedWorkoutTypeId) as NonNullable<
    ReturnType<typeof getWahooWorkoutTypeById>
  >;

  for (const workoutId of options.workoutIds) {
    const before = await requestWahooAPI<WahooWorkoutPayload>(
      accessToken,
      `/v1/workouts/${encodeURIComponent(workoutId)}`,
    );
    console.info(JSON.stringify({
      mode: options.apply ? 'apply' : 'verify',
      workoutId,
      before: safeWorkoutSummary(before.data || {}),
      expected: expectedWorkoutType,
    }));

    if (!options.apply) continue;
    await assertWahooCorrectionMutationAllowed(options.uid);
    await requestWahooAPI(
      accessToken,
      `/v1/workouts/${encodeURIComponent(workoutId)}`,
      { method: 'PUT', form: buildWahooWorkoutTypeUpdateForm(expectedWorkoutType.id) },
    );
    const after = await requestWahooAPI<WahooWorkoutPayload>(
      accessToken,
      `/v1/workouts/${encodeURIComponent(workoutId)}`,
    );
    const afterSummary = safeWorkoutSummary(after.data || {});
    console.info(JSON.stringify({
      mode: 'verified_after_apply',
      workoutId,
      after: afterSummary,
      expected: expectedWorkoutType,
    }));
    assertWahooCorrectionApplied(workoutId, afterSummary, expectedWorkoutType);
  }
}

if (require.main === module) {
  void runWahooWorkoutTypeCorrectionScript().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
