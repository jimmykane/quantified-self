import { FieldValue } from 'firebase-admin/firestore';

export interface RevisionProcessingLeaseFields {
  processingOwner?: unknown;
  processingRevision?: unknown;
  processingLeaseExpiresAt?: unknown;
}

export interface ActiveRevisionProcessingLease {
  processingOwner: string;
  processingRevision: string;
  processingLeaseExpiresAt: number;
}

export function getActiveRevisionProcessingLease(
  queueItem: RevisionProcessingLeaseFields | null | undefined,
  nowMs = Date.now(),
): ActiveRevisionProcessingLease | null {
  const processingOwner = typeof queueItem?.processingOwner === 'string'
    ? queueItem.processingOwner.trim()
    : '';
  const processingRevision = typeof queueItem?.processingRevision === 'string'
    ? queueItem.processingRevision.trim()
    : '';
  const processingLeaseExpiresAt = Number(queueItem?.processingLeaseExpiresAt || 0);
  if (!processingOwner
    || !processingRevision
    || !Number.isFinite(processingLeaseExpiresAt)
    || processingLeaseExpiresAt <= nowMs) {
    return null;
  }
  return {
    processingOwner,
    processingRevision,
    processingLeaseExpiresAt,
  };
}

export function clearRevisionProcessingLeaseUpdate(): Record<string, FieldValue> {
  return {
    processingOwner: FieldValue.delete(),
    processingRevision: FieldValue.delete(),
    processingLeaseExpiresAt: FieldValue.delete(),
  };
}
