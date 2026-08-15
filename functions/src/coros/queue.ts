import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as crypto from 'crypto';
import { addToQueueForCOROS } from '../queue';
import { isProviderQueueSkippedWithoutRetryError } from '../queue/provider-queue-errors';

import { COROSAPIWorkoutQueueItemInterface } from '../queue/queue-item.interface';
import { generateIDFromParts } from '../utils';
import { config } from '../config';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { normalizeCOROSOpenId } from './account';
import { parseCOROSJSON } from './json';
import { normalizeCOROSInt64Identifier } from './identifier';
import { containsASCIIControlCharacter } from './input-validation';

const MAX_COROS_WORKOUTS_PER_WEBHOOK = 1_000;
const MAX_COROS_COMPONENTS_PER_WORKOUT = 100;
const MAX_COROS_QUEUE_ITEMS_PER_BATCH = 1_000;
const MAX_COROS_DEVICE_NAME_LENGTH = 200;
const MAX_COROS_FIT_URL_LENGTH = 4_096;
const MAX_COROS_WEBHOOK_BODY_BYTES = 8 * 1024 * 1024;
const COROS_WEBHOOK_QUEUE_CONCURRENCY = 10;
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

function isCOROSCompositeWorkout(mode: number, subMode: number): boolean {
  return mode === 13 && (subMode === 1 || subMode === 2);
}

const WEBHOOK_RESPONSES = {
  success: { message: 'ok', result: '0000' },
  unauthorized: { message: 'authentication failed', result: '1001' },
  invalidPayload: { message: 'invalid payload', result: '1002' },
  unavailable: { message: 'temporarily unavailable', result: '2001' },
} as const;

interface COROSWorkoutSummary {
  openId: string;
  labelId: string;
  mode: number;
  subMode: number;
  deviceName?: string;
  startTimezone?: number;
  endTimezone?: number;
  planWorkoutId?: string;
  fitUrl?: string;
  triathlonItemList?: COROSWorkoutComponent[];
}

interface COROSWorkoutComponent {
  mode: number;
  subMode: number;
  fitUrl?: string;
}

interface COROSWebhookPayload {
  sportDataList?: unknown;
}

export class InvalidCOROSWorkoutPayloadError extends Error {
  readonly name = 'InvalidCOROSWorkoutPayloadError';

  constructor(public readonly reason: string) {
    super('COROS workout payload is invalid.');
  }
}

function redactProviderUserId(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const trimmed = value.trim();
  return `sha256:${crypto.createHash('sha256').update(trimmed).digest('hex').slice(0, 12)}`;
}

function constantTimeCredentialMatches(actual: unknown, expected: unknown): boolean {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !actual || !expected) {
    return false;
  }
  const actualDigest = crypto.createHash('sha256').update(actual).digest();
  const expectedDigest = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

function normalizeInt32(value: unknown, field: string): number {
  const normalized = typeof value === 'string' && /^-?\d+$/.test(value.trim())
    ? Number(value)
    : value;
  if (!Number.isInteger(normalized) || Number(normalized) < INT32_MIN || Number(normalized) > INT32_MAX) {
    throw new InvalidCOROSWorkoutPayloadError(`invalid_${field}`);
  }
  return Number(normalized);
}

function normalizeOptionalInt32(value: unknown, field: string): number | undefined {
  return value === undefined || value === null || value === '' ? undefined : normalizeInt32(value, field);
}

function normalizeCOROSIdentifier(value: unknown, field: string): string {
  const normalized = normalizeCOROSInt64Identifier(value);
  if (!normalized) {
    throw new InvalidCOROSWorkoutPayloadError(`invalid_${field}`);
  }
  return normalized;
}

function normalizeOptionalCOROSIdentifier(value: unknown, field: string): string | undefined {
  return value === undefined || value === null || value === ''
    ? undefined
    : normalizeCOROSIdentifier(value, field);
}

function normalizeOptionalBoundedString(value: unknown, field: string, maximumLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new InvalidCOROSWorkoutPayloadError(`invalid_${field}`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength || containsASCIIControlCharacter(normalized)) {
    throw new InvalidCOROSWorkoutPayloadError(`invalid_${field}`);
  }
  return normalized;
}

function normalizeWorkoutComponent(value: unknown): COROSWorkoutComponent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidCOROSWorkoutPayloadError('invalid_component');
  }
  const component = value as Record<string, unknown>;
  return {
    mode: normalizeInt32(component.mode, 'component_mode'),
    subMode: normalizeInt32(component.subMode, 'component_sub_mode'),
    fitUrl: normalizeOptionalBoundedString(component.fitUrl, 'component_fit_url', MAX_COROS_FIT_URL_LENGTH),
  };
}

function normalizeWorkoutSummary(value: unknown, overrideOpenId?: string): COROSWorkoutSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidCOROSWorkoutPayloadError('invalid_workout');
  }
  const workout = value as Record<string, unknown>;
  const openId = normalizeCOROSOpenId(overrideOpenId || workout.openId);
  if (!openId) {
    throw new InvalidCOROSWorkoutPayloadError('invalid_open_id');
  }
  const rawComponents = workout.triathlonItemList;
  if (rawComponents !== undefined && rawComponents !== null && !Array.isArray(rawComponents)) {
    throw new InvalidCOROSWorkoutPayloadError('invalid_component_list');
  }
  if (Array.isArray(rawComponents) && rawComponents.length > MAX_COROS_COMPONENTS_PER_WORKOUT) {
    throw new InvalidCOROSWorkoutPayloadError('component_list_too_large');
  }
  const mode = normalizeInt32(workout.mode, 'mode');
  const subMode = normalizeInt32(workout.subMode, 'sub_mode');
  const compositeWorkout = isCOROSCompositeWorkout(mode, subMode);
  const triathlonItemList = compositeWorkout && Array.isArray(rawComponents) && rawComponents.length > 0
    ? rawComponents.map(normalizeWorkoutComponent)
    : undefined;
  if (compositeWorkout && !triathlonItemList) {
    throw new InvalidCOROSWorkoutPayloadError('missing_multisport_components');
  }

  return {
    openId,
    labelId: normalizeCOROSIdentifier(workout.labelId, 'label_id'),
    mode,
    subMode,
    deviceName: normalizeOptionalBoundedString(workout.deviceName, 'device_name', MAX_COROS_DEVICE_NAME_LENGTH),
    startTimezone: normalizeOptionalInt32(workout.startTimezone, 'start_timezone'),
    endTimezone: normalizeOptionalInt32(workout.endTimezone, 'end_timezone'),
    planWorkoutId: normalizeOptionalCOROSIdentifier(workout.planWorkoutId, 'plan_workout_id'),
    fitUrl: normalizeOptionalBoundedString(workout.fitUrl, 'fit_url', MAX_COROS_FIT_URL_LENGTH),
    triathlonItemList,
  };
}

function parseWebhookBody(req: functions.https.Request): COROSWebhookPayload {
  const rawBody = (req as functions.https.Request & { rawBody?: Buffer }).rawBody;
  if (Buffer.isBuffer(rawBody) && rawBody.length > 0) {
    if (rawBody.length > MAX_COROS_WEBHOOK_BODY_BYTES) {
      throw new InvalidCOROSWorkoutPayloadError('body_too_large');
    }
    return parseCOROSJSON<COROSWebhookPayload>(rawBody);
  }
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    return req.body as COROSWebhookPayload;
  }
  throw new InvalidCOROSWorkoutPayloadError('invalid_body');
}

function countMissingFitUrls(workouts: COROSWorkoutSummary[]): number {
  return workouts.reduce((total, workout) => {
    if (workout.triathlonItemList) {
      return total + workout.triathlonItemList.filter(item => !item.fitUrl).length;
    }
    return total + (workout.fitUrl ? 0 : 1);
  }, 0);
}

function sendWebhookResponse(
  res: functions.Response,
  status: number,
  payload: typeof WEBHOOK_RESPONSES[keyof typeof WEBHOOK_RESPONSES],
): void {
  res.status(status).send(payload);
}

export const insertCOROSAPIWorkoutDataToQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: 300,
  memory: '256MB',
  secrets: FUNCTION_SECRET_BINDINGS.insertCOROSAPIWorkoutDataToQueue,
}).https.onRequest(async (req, res) => {
  if (req.method === 'GET') {
    sendWebhookResponse(res, 200, WEBHOOK_RESPONSES.success);
    return;
  }
  if (req.method !== 'POST') {
    res.set('Allow', 'GET, POST');
    sendWebhookResponse(res, 405, WEBHOOK_RESPONSES.invalidPayload);
    return;
  }

  if (!constantTimeCredentialMatches(req.get('Client'), config.corosapi.client_id)
    || !constantTimeCredentialMatches(req.get('Secret'), config.corosapi.client_secret)) {
    logger.warn('Rejected unauthenticated COROS workout webhook.', { provider: 'COROS' });
    sendWebhookResponse(res, 401, WEBHOOK_RESPONSES.unauthorized);
    return;
  }

  let normalizedWorkouts: COROSWorkoutSummary[];
  try {
    const body = parseWebhookBody(req);
    if (!Array.isArray(body.sportDataList)
      || body.sportDataList.length === 0
      || body.sportDataList.length > MAX_COROS_WORKOUTS_PER_WEBHOOK) {
      throw new InvalidCOROSWorkoutPayloadError('invalid_sport_data_list');
    }
    normalizedWorkouts = body.sportDataList.map(workout => normalizeWorkoutSummary(workout));
  } catch (error) {
    logger.warn('Rejected invalid COROS workout webhook payload.', {
      provider: 'COROS',
      reason: error instanceof InvalidCOROSWorkoutPayloadError ? error.reason : 'invalid_json',
    });
    sendWebhookResponse(res, 400, WEBHOOK_RESPONSES.invalidPayload);
    return;
  }

  logger.info('COROS workout webhook received', {
    provider: 'COROS',
    sportDataCount: normalizedWorkouts.length,
    providerUserIds: Array.from(new Set(normalizedWorkouts
      .map(workout => redactProviderUserId(workout.openId))
      .filter((openId): openId is string => !!openId))),
  });

  let queueItems: COROSAPIWorkoutQueueItemInterface[];
  try {
    queueItems = await convertCOROSWorkoutsToQueueItems(normalizedWorkouts);
  } catch (error) {
    logger.warn('Could not convert a COROS workout webhook payload.', {
      provider: 'COROS',
      reason: error instanceof InvalidCOROSWorkoutPayloadError ? error.reason : 'conversion_failed',
    });
    sendWebhookResponse(res, 400, WEBHOOK_RESPONSES.invalidPayload);
    return;
  }

  let queuedCount = 0;
  let skippedCount = 0;
  for (let offset = 0; offset < queueItems.length; offset += COROS_WEBHOOK_QUEUE_CONCURRENCY) {
    const queueResults = await Promise.all(
      queueItems.slice(offset, offset + COROS_WEBHOOK_QUEUE_CONCURRENCY).map(async workout => {
        try {
          await addToQueueForCOROS(workout);
          return { status: 'queued' as const };
        } catch (error) {
          if (isProviderQueueSkippedWithoutRetryError(error)) {
            logger.warn('Skipping COROS workout webhook because no local token/user is connected or the user is being deleted.', {
              provider: 'COROS',
              reason: (error as { code?: unknown }).code,
              queueItemId: workout.id,
              providerUserId: redactProviderUserId(workout.openId),
            });
            return { status: 'skipped' as const };
          }
          return { status: 'failed' as const, error };
        }
      }),
    );
    queuedCount += queueResults.filter(result => result.status === 'queued').length;
    skippedCount += queueResults.filter(result => result.status === 'skipped').length;
    const failedResult = queueResults.find(result => result.status === 'failed');
    if (failedResult?.status === 'failed') {
      logger.error('Temporarily failed to queue a COROS workout webhook item.', {
        provider: 'COROS',
        errorName: failedResult.error instanceof Error ? failedResult.error.name : typeof failedResult.error,
      });
      sendWebhookResponse(res, 503, WEBHOOK_RESPONSES.unavailable);
      return;
    }
  }

  logger.info('Insert to Queue for COROS success responding with ok', {
    provider: 'COROS',
    queuedCount,
    skippedCount,
    convertedQueueItemCount: queueItems.length,
    missingFitUrlCount: countMissingFitUrls(normalizedWorkouts),
  });
  sendWebhookResponse(res, 200, WEBHOOK_RESPONSES.success);
});

export async function convertCOROSWorkoutsToQueueItems(
  workouts: unknown[],
  openId?: string,
): Promise<COROSAPIWorkoutQueueItemInterface[]> {
  if (workouts.length > MAX_COROS_WORKOUTS_PER_WEBHOOK) {
    throw new InvalidCOROSWorkoutPayloadError('workout_list_too_large');
  }
  const normalizedWorkouts = workouts.map(workout => normalizeWorkoutSummary(workout, openId));
  const expandedQueueItemCount = normalizedWorkouts.reduce(
    (total, workout) => total + (workout.triathlonItemList?.length || 1),
    0,
  );
  if (expandedQueueItemCount > MAX_COROS_QUEUE_ITEMS_PER_BATCH) {
    throw new InvalidCOROSWorkoutPayloadError('expanded_workout_list_too_large');
  }
  const queueItems: COROSAPIWorkoutQueueItemInterface[] = [];

  for (const workout of normalizedWorkouts) {
    if (workout.triathlonItemList) {
      for (let componentIndex = 0; componentIndex < workout.triathlonItemList.length; componentIndex++) {
        const component = workout.triathlonItemList[componentIndex];
        queueItems.push(await getCOROSQueueItemFromWorkout({
          ...workout,
          mode: component.mode,
          subMode: component.subMode,
          detailMode: workout.mode,
          detailSubMode: workout.subMode,
          fitUrl: component.fitUrl,
          componentIndex,
          componentKey: `component:${componentIndex}:${component.mode}:${component.subMode}`,
        }));
      }
      continue;
    }

    queueItems.push(await getCOROSQueueItemFromWorkout({
      ...workout,
      detailMode: workout.mode,
      detailSubMode: workout.subMode,
      componentKey: 'root',
    }));
  }
  return queueItems;
}

interface COROSQueueItemInput extends COROSWorkoutSummary {
  detailMode: number;
  detailSubMode: number;
  componentIndex?: number;
  componentKey: string;
}

export async function getCOROSQueueItemFromWorkout(
  inputOrOpenId: COROSQueueItemInput | string,
  legacyLabelId?: string,
  legacyFitUrl?: string,
): Promise<COROSAPIWorkoutQueueItemInterface> {
  const input: COROSQueueItemInput = typeof inputOrOpenId === 'string'
    ? {
      openId: inputOrOpenId,
      labelId: normalizeCOROSIdentifier(legacyLabelId, 'label_id'),
      mode: 0,
      subMode: 0,
      detailMode: 0,
      detailSubMode: 0,
      fitUrl: normalizeOptionalBoundedString(legacyFitUrl, 'fit_url', MAX_COROS_FIT_URL_LENGTH),
      componentKey: 'root',
    }
    : inputOrOpenId;

  return {
    id: await generateIDFromParts([input.openId, input.labelId, input.componentKey]),
    dateCreated: Date.now(),
    openId: input.openId,
    workoutID: input.labelId,
    ...(input.fitUrl ? { FITFileURI: input.fitUrl } : {}),
    mode: input.mode,
    subMode: input.subMode,
    detailMode: input.detailMode,
    detailSubMode: input.detailSubMode,
    ...(input.deviceName ? { deviceName: input.deviceName } : {}),
    ...(input.startTimezone !== undefined ? { startTimezone: input.startTimezone } : {}),
    ...(input.endTimezone !== undefined ? { endTimezone: input.endTimezone } : {}),
    ...(input.planWorkoutId ? { planWorkoutId: input.planWorkoutId } : {}),
    ...(input.componentIndex !== undefined ? { componentIndex: input.componentIndex } : {}),
    componentKey: input.componentKey,
    retryCount: 0,
    processed: false,
    dispatchedToCloudTask: null,
  };
}
