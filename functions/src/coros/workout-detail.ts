import { COROSAPIAuth2ServiceTokenInterface } from '@sports-alliance/sports-lib';

import * as requestPromise from '../request-helper';
import { COROSAPIWorkoutQueueItemInterface } from '../queue/queue-item.interface';
import { normalizeCOROSOpenId } from './account';
import {
  COROS_API_REQUEST_TIMEOUT_MS,
  PRODUCTION_URL,
  STAGING_URL,
  USE_STAGING,
} from './constants';
import { parseCOROSJSON } from './json';
import { normalizeCOROSInt64Identifier } from './identifier';
import { containsASCIIControlCharacter } from './input-validation';

const MAX_COROS_FIT_URL_LENGTH = 4_096;
const MAX_COROS_FIT_DETAIL_RESPONSE_BYTES = 1024 * 1024;

interface COROSFITDetailComponent {
  mode?: unknown;
  subMode?: unknown;
  fitUrl?: unknown;
}

interface COROSFITDetailData {
  labelId?: unknown;
  mode?: unknown;
  subMode?: unknown;
  fitUrl?: unknown;
  triathlonItemList?: unknown;
}

interface COROSFITDetailResponse {
  result?: unknown;
  message?: unknown;
  data?: unknown;
}

export class RetryableCOROSFITDetailError extends Error {
  readonly name = 'RetryableCOROSFITDetailError';

  constructor(public readonly providerCode?: string) {
    super('COROS FIT detail is temporarily unavailable.');
  }
}

export class COROSFITDetailAuthError extends Error {
  readonly name = 'COROSFITDetailAuthError';

  constructor(public readonly providerCode?: string) {
    super('COROS authorization is required to recover the FIT detail.');
  }
}

export class PermanentCOROSFITDetailError extends Error {
  readonly name = 'PermanentCOROSFITDetailError';

  constructor(public readonly reason: string, public readonly providerCode?: string) {
    super('COROS FIT detail response cannot be used.');
  }
}

function finiteInt32(value: unknown): number | null {
  const normalized = typeof value === 'string' && /^-?\d+$/.test(value.trim())
    ? Number(value)
    : value;
  return Number.isInteger(normalized)
    && Number(normalized) >= -2_147_483_648
    && Number(normalized) <= 2_147_483_647
    ? Number(normalized)
    : null;
}

function normalizeFitUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized
    && normalized.length <= MAX_COROS_FIT_URL_LENGTH
    && !containsASCIIControlCharacter(normalized)
    ? normalized
    : null;
}

function responseCode(response: COROSFITDetailResponse): string {
  return `${response.result ?? ''}`.trim();
}

function toDetailError(response: COROSFITDetailResponse): Error | null {
  const code = responseCode(response);
  const message = `${response.message ?? ''}`.trim();
  if (code && /^0+$/.test(code)) {
    return !message || message === 'OK'
      ? null
      : new PermanentCOROSFITDetailError('contradictory_success_response', code);
  }
  if (code === '5016') return new RetryableCOROSFITDetailError(code);
  if (code === '5006') return new COROSFITDetailAuthError(code);
  if (code === '5010') return new PermanentCOROSFITDetailError('invalid_open_id', code);
  return new PermanentCOROSFITDetailError('provider_rejected_detail_request', code || undefined);
}

function statusCodeFromError(error: unknown): number | null {
  const statusCode = Number((error as { statusCode?: unknown } | null)?.statusCode);
  return Number.isFinite(statusCode) ? statusCode : null;
}

function parseDetailResponse(rawResponse: unknown): COROSFITDetailResponse {
  if (typeof rawResponse !== 'string' && !Buffer.isBuffer(rawResponse)) {
    throw new PermanentCOROSFITDetailError('invalid_response_body');
  }
  try {
    return parseCOROSJSON<COROSFITDetailResponse>(rawResponse);
  } catch {
    throw new PermanentCOROSFITDetailError('invalid_json');
  }
}

function selectFitUrl(
  response: COROSFITDetailResponse,
  queueItem: COROSAPIWorkoutQueueItemInterface,
): string {
  if (!response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
    throw new PermanentCOROSFITDetailError('missing_detail_data');
  }
  const data = response.data as COROSFITDetailData;
  const responseLabelId = normalizeCOROSInt64Identifier(data.labelId);
  if (!responseLabelId || responseLabelId !== queueItem.workoutID) {
    throw new PermanentCOROSFITDetailError('workout_id_mismatch');
  }
  const responseMode = finiteInt32(data.mode);
  const responseSubMode = finiteInt32(data.subMode);
  const expectedDetailMode = finiteInt32(queueItem.detailMode ?? queueItem.mode);
  const expectedDetailSubMode = finiteInt32(queueItem.detailSubMode ?? queueItem.subMode);
  if (responseMode === null
    || responseSubMode === null
    || responseMode !== expectedDetailMode
    || responseSubMode !== expectedDetailSubMode) {
    throw new PermanentCOROSFITDetailError('parent_workout_type_mismatch');
  }

  if (queueItem.componentIndex === undefined) {
    const fitUrl = normalizeFitUrl(data.fitUrl);
    if (!fitUrl) throw new PermanentCOROSFITDetailError('missing_fit_url');
    return fitUrl;
  }

  const componentIndex = queueItem.componentIndex;
  const expectedComponentMode = finiteInt32(queueItem.mode);
  const expectedComponentSubMode = finiteInt32(queueItem.subMode);
  if (!Number.isInteger(componentIndex)
    || componentIndex < 0
    || expectedComponentMode === null
    || expectedComponentSubMode === null) {
    throw new PermanentCOROSFITDetailError('invalid_multisport_component_identity');
  }
  const expectedComponentKey = `component:${componentIndex}:${expectedComponentMode}:${expectedComponentSubMode}`;
  if (queueItem.componentKey && queueItem.componentKey !== expectedComponentKey) {
    throw new PermanentCOROSFITDetailError('invalid_multisport_component_identity');
  }
  if (!Array.isArray(data.triathlonItemList)
    || componentIndex >= data.triathlonItemList.length) {
    throw new PermanentCOROSFITDetailError('missing_multisport_component');
  }
  const component = data.triathlonItemList[componentIndex] as COROSFITDetailComponent | null;
  if (!component || typeof component !== 'object') {
    throw new PermanentCOROSFITDetailError('invalid_multisport_component');
  }
  if (finiteInt32(component.mode) !== expectedComponentMode
    || finiteInt32(component.subMode) !== expectedComponentSubMode) {
    throw new PermanentCOROSFITDetailError('multisport_component_mismatch');
  }
  const fitUrl = normalizeFitUrl(component.fitUrl);
  if (!fitUrl) throw new PermanentCOROSFITDetailError('missing_multisport_fit_url');
  return fitUrl;
}

/** Recovers a fresh signed FIT URL by stable COROS workout identity. */
export async function recoverCOROSFITFileURL(
  serviceToken: COROSAPIAuth2ServiceTokenInterface,
  queueItem: COROSAPIWorkoutQueueItemInterface,
): Promise<string> {
  const accessToken = typeof serviceToken.accessToken === 'string' ? serviceToken.accessToken.trim() : '';
  const openId = normalizeCOROSOpenId(queueItem.openId);
  const workoutID = normalizeCOROSInt64Identifier(queueItem.workoutID);
  const detailMode = finiteInt32(queueItem.detailMode ?? queueItem.mode);
  const detailSubMode = finiteInt32(queueItem.detailSubMode ?? queueItem.subMode);
  if (!accessToken || !openId || !workoutID || detailMode === null || detailSubMode === null) {
    throw new PermanentCOROSFITDetailError('invalid_detail_request_identity');
  }

  const query = new URLSearchParams({
    token: accessToken,
    openId,
    labelId: workoutID,
    mode: `${detailMode}`,
    subMode: `${detailSubMode}`,
  });

  let rawResponse: unknown;
  try {
    rawResponse = await requestPromise.get({
      url: `${USE_STAGING ? STAGING_URL : PRODUCTION_URL}/v2/coros/sport/detail/fit?${query.toString()}`,
      timeout: COROS_API_REQUEST_TIMEOUT_MS,
      maxResponseBytes: MAX_COROS_FIT_DETAIL_RESPONSE_BYTES,
    });
  } catch (error) {
    if (error instanceof requestPromise.ResponseBodyTooLargeError) {
      throw new PermanentCOROSFITDetailError('detail_response_too_large');
    }
    const statusCode = statusCodeFromError(error);
    if (statusCode === 401 || statusCode === 403) {
      throw new COROSFITDetailAuthError(`${statusCode}`);
    }
    if (statusCode === 408 || statusCode === 429 || (statusCode !== null && statusCode >= 500)) {
      throw new RetryableCOROSFITDetailError(statusCode === null ? undefined : `${statusCode}`);
    }
    if (statusCode !== null) {
      throw new PermanentCOROSFITDetailError('detail_http_rejected', `${statusCode}`);
    }
    throw new RetryableCOROSFITDetailError();
  }

  const response = parseDetailResponse(rawResponse);
  const responseError = toDetailError(response);
  if (responseError) throw responseError;
  return selectFitUrl(response, queueItem);
}
