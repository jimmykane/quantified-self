import { config } from '../config';
import { getBinaryResponse } from '../request-helper';
import {
  FitPayloadInspectionReason,
  inspectFitPayload,
  normalizeDownloadedFitPayload,
} from '../shared/fit-payload';
import { toSuuntoAuthorizationHeader } from './authorization-header';
import { SUUNTO_SUSPICIOUS_EMPTY_FIT_MAX_BYTES } from './constants';

export const SUUNTO_FIT_RETRY_EXHAUSTED_CONTEXT = 'SUUNTO_FIT_RESPONSE_RETRY_EXHAUSTED';

export type SuuntoFITContentTypeCategory = 'fit' | 'json' | 'text' | 'binary' | 'missing' | 'other';
export type RetryableSuuntoFITPayloadReason = Exclude<FitPayloadInspectionReason, 'valid'>
  | 'sessionless_suspiciously_small'
  | 'unexpected_success_status';

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
 * Downloads and structurally validates a Suunto FIT response.
 * Provider-controlled body contents and raw content-type values never enter logs or queue errors.
 */
export async function downloadSuuntoFITFile(
  accessToken: string,
  workoutID: string,
): Promise<Buffer> {
  const response = await getBinaryResponse({
    headers: {
      Accept: 'application/octet-stream',
      Authorization: toSuuntoAuthorizationHeader(accessToken),
      'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
    },
    url: `https://cloudapi.suunto.com/v3/workouts/${encodeURIComponent(workoutID)}/fit`,
  });

  if (response.statusCode !== 200) {
    throw new RetryableSuuntoFITPayloadError(
      'unexpected_success_status',
      response.body.length,
      classifyContentType(response.contentType),
    );
  }

  const rootInspection = inspectFitPayload(response.body);
  if (rootInspection.isCompleteFit) {
    // Keep direct FIT downloads byte-for-byte intact. The manual endpoint promises
    // the original file, and valid FIT files may contain chained trailing payloads.
    return response.body;
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
