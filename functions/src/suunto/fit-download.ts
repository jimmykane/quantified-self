import { config } from '../config';
import {
  getBinaryResponse,
  ResponseBodyTooLargeError,
} from '../request-helper';
import {
  MAX_ACTIVITY_UPLOAD_BYTES,
  MAX_ACTIVITY_UPLOAD_BYTES_LABEL,
} from '../shared/activity-processing-config';
import {
  FitPayloadInspectionReason,
  inspectFitPayload,
  normalizeDownloadedFitPayload,
} from '../shared/fit-payload';
import { toSuuntoAuthorizationHeader } from './authorization-header';
import {
  SUUNTO_FIT_DOWNLOAD_TIMEOUT_MS,
  SUUNTO_SUSPICIOUS_EMPTY_FIT_MAX_BYTES,
} from './constants';

export const SUUNTO_FIT_RETRY_EXHAUSTED_CONTEXT = 'SUUNTO_FIT_RESPONSE_RETRY_EXHAUSTED';

export type SuuntoFITContentTypeCategory = 'fit' | 'json' | 'text' | 'binary' | 'missing' | 'other';
export type RetryableSuuntoFITPayloadReason = Exclude<FitPayloadInspectionReason, 'valid'>
  | 'sessionless_suspiciously_small';

function classifyContentType(contentType: string | null): SuuntoFITContentTypeCategory {
  const normalized = `${contentType || ''}`.trim().toLowerCase();
  if (!normalized) return 'missing';
  if (normalized.includes('json')) return 'json';
  if (normalized.startsWith('text/')) return 'text';
  if (normalized.includes('fit')) return 'fit';
  if (normalized.includes('octet-stream') || normalized.includes('binary')) return 'binary';
  return 'other';
}

export class RetryableSuuntoFITPayloadError extends Error {
  readonly name = 'RetryableSuuntoFITPayloadError';

  constructor(
    readonly reason: RetryableSuuntoFITPayloadReason,
    readonly byteLength: number,
    readonly contentTypeCategory: SuuntoFITContentTypeCategory,
  ) {
    super(`Suunto FIT response was not ready for import (${reason}; ${byteLength} bytes).`);
  }
}

export class PermanentSuuntoFITPayloadError extends Error {
  readonly name = 'PermanentSuuntoFITPayloadError';

  constructor(readonly reason: 'response_too_large') {
    super(`Suunto FIT response exceeds the ${MAX_ACTIVITY_UPLOAD_BYTES_LABEL} limit.`);
  }
}

export function isSuspiciouslySmallSuuntoFIT(byteLength: number): boolean {
  return Number.isFinite(byteLength)
    && byteLength >= 0
    && byteLength <= SUUNTO_SUSPICIOUS_EMPTY_FIT_MAX_BYTES;
}

export function createSessionlessSuuntoFITError(byteLength: number): RetryableSuuntoFITPayloadError {
  return new RetryableSuuntoFITPayloadError(
    'sessionless_suspiciously_small',
    byteLength,
    'fit',
  );
}

/**
 * Downloads, bounds, and structurally validates a Suunto FIT response.
 * Provider-controlled body contents and raw content-type values never enter logs or queue errors.
 */
export async function downloadSuuntoFITFile(
  accessToken: string,
  workoutID: string,
): Promise<Buffer> {
  let response;
  try {
    response = await getBinaryResponse({
      headers: {
        Accept: 'application/octet-stream',
        Authorization: toSuuntoAuthorizationHeader(accessToken),
        'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
      },
      maxResponseBytes: MAX_ACTIVITY_UPLOAD_BYTES,
      timeout: SUUNTO_FIT_DOWNLOAD_TIMEOUT_MS,
      url: `https://cloudapi.suunto.com/v3/workouts/${encodeURIComponent(workoutID)}/fit`,
    });
  } catch (error) {
    if (error instanceof ResponseBodyTooLargeError) {
      throw new PermanentSuuntoFITPayloadError('response_too_large');
    }
    throw error;
  }

  const normalized = normalizeDownloadedFitPayload(response.body);
  const inspection = inspectFitPayload(normalized.data);
  if (!inspection.isCompleteFit) {
    throw new RetryableSuuntoFITPayloadError(
      inspection.reason as Exclude<FitPayloadInspectionReason, 'valid'>,
      inspection.byteLength,
      classifyContentType(response.contentType),
    );
  }
  return normalized.data;
}
