import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { HttpsError } from 'firebase-functions/v2/https';
import { ACTIVITY_SEND_LIMITS, ActivitySendRecovery, ActivitySendStatus } from '../../../shared/activity-send';
import { inspectFitPayload, type FitPayloadInspectionReason } from '../shared/fit-payload';

type SendFileValidationReason = 'empty_body' | 'file_too_large' | 'unsupported_extension'
  | 'invalid_gzip' | 'gzip_output_too_large' | Exclude<FitPayloadInspectionReason, 'valid'>;

export class SendFileValidationError extends HttpsError {
  constructor(readonly validationReason: SendFileValidationReason, readonly receivedBytes: number, message: string) {
    super('invalid-argument', message);
  }
}

export function sendIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new HttpsError('invalid-argument', 'Invalid send reference.');
  return value;
}
export function decodeSendFile(input: Buffer, filename: string): Buffer {
  if (!input.length || input.length > ACTIVITY_SEND_LIMITS.fileBytes || !/\.fit(?:\.gz)?$/i.test(filename)) {
    const reason = !input.length ? 'empty_body' : input.length > ACTIVITY_SEND_LIMITS.fileBytes ? 'file_too_large' : 'unsupported_extension';
    throw new SendFileValidationError(reason, input.length, 'Choose a FIT or FIT.gz file up to 20 MiB.');
  }
  let fit: Buffer;
  try { fit = /\.gz$/i.test(filename) ? gunzipSync(input, { maxOutputLength: ACTIVITY_SEND_LIMITS.fileBytes }) : input; }
  catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE' ? 'gzip_output_too_large' : 'invalid_gzip';
    throw new SendFileValidationError(reason, input.length, 'FIT.gz cannot be expanded within 20 MiB.');
  }
  const inspection = inspectFitPayload(fit);
  if (inspection.reason !== 'valid') throw new SendFileValidationError(inspection.reason, input.length, 'The selected file is not a complete FIT recording.');
  return fit;
}
export function sendFileHash(fit: Buffer): string { return createHash('sha256').update(fit).digest('hex'); }
export function isSendWindowOpen(operation: Record<string, unknown> | undefined, now = Date.now()): boolean {
  return operation?.state === 'confirmed' && operation.stopped !== true && Number.isFinite(operation.expiresAt) && Number(operation.expiresAt) > now;
}

/** Delivery progress is not new admission intent; retain every other control/continuation change. */
export function sendOperationNeedsAdmission(before: Record<string, unknown> | undefined, after: Record<string, unknown>): boolean {
  return !before || Object.keys({ ...before, ...after }).some(key => key !== 'finished' && key !== 'updatedAt'
    && !isDeepStrictEqual(before[key], after[key]));
}

/** Project only fixed, user-actionable categories; never copy provider errors/IDs. */
export function projectSendQueue(data: Record<string, unknown>): { status: ActivitySendStatus; recovery: ActivitySendRecovery; message: string } {
  const connectionIssue = !!data.deferredReason || ['destination_not_connected', 'destination_auth_failed', 'destination_permission_required'].includes(`${data.skippedReason}`);
  if (data.resultStatus === 'success') return data.destinationInfoCode === 'ALREADY_EXISTS'
    ? { status: 'duplicate', recovery: 'none', message: 'Already exists in the provider.' }
    : { status: 'delivered', recovery: 'none', message: 'Provider confirmed delivery.' };
  if (data.skippedReason === 'send_stopped') return { status: 'stopped', recovery: 'none', message: 'Stopped before sending.' };
  if (data.skippedReason === 'send_source_expired') return { status: 'needs_action', recovery: 'choose_file', message: 'The temporary source expired. Review a new draft before sending.' };
  if (data.skippedReason === 'no_pro_access') return { status: 'needs_action', recovery: 'upgrade', message: 'Pro is required to start this send.' };
  if (data.sendConfirmedFailure === true) return { status: 'needs_action', recovery: 'retry_send', message: 'Provider confirmed processing failed.' };
  if (data.resultStatus === 'manual_reconciliation_required' || (data.providerOperationStartedAt && !data.destinationUploadID && (data.processed || connectionIssue))) {
    return { status: 'needs_action', recovery: 'review_provider', message: 'Acceptance is unknown. Check the provider before sending another copy.' };
  }
  if (connectionIssue) {
    return { status: 'needs_action', recovery: data.destinationUploadID ? 'check_status' : 'reconnect', message: 'Review the connection in Connections. Accepted uploads will not be resent.' };
  }
  if (data.destinationUploadID && data.processed) return { status: 'needs_action', recovery: 'check_status', message: 'Check the existing provider operation.' };
  if (data.processed) return { status: 'needs_action', recovery: 'choose_file', message: 'This activity could not be sent. Review its original file.' };
  if (data.destinationUploadID) return { status: 'processing', recovery: 'check_status', message: 'Waiting for provider processing.' };
  if (data.providerOperationStartedAt) return { status: 'sending', recovery: 'none', message: 'Sending to the provider.' };
  return { status: 'queued', recovery: 'none', message: 'Queued for background delivery.' };
}
