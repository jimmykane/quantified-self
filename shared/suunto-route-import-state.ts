export interface SuuntoRouteImportStateEntry {
  sourceKey: string;
  providerUserId: string;
  didLastRouteImport?: unknown;
  queuedCount?: number;
  skippedCount?: number;
  failureCount?: number;
  totalCount?: number;
  updatedAt?: unknown;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value);
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof (value as { toDate?: unknown } | null)?.toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (
    typeof (value as { seconds?: unknown } | null)?.seconds === 'number'
    && typeof (value as { nanoseconds?: unknown } | null)?.nanoseconds === 'number'
  ) {
    const timestamp = value as { seconds: number; nanoseconds: number };
    return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000);
  }
  return null;
}

export function getSuuntoProviderUserIdFromTokenLike(serviceToken: unknown): string | null {
  if (!serviceToken || typeof serviceToken !== 'object') {
    return null;
  }

  const userName = (serviceToken as { userName?: unknown }).userName;
  return typeof userName === 'string' && userName.trim().length > 0
    ? userName.trim()
    : null;
}

export function buildSuuntoServiceTokenFingerprint(serviceToken: unknown): string | null {
  if (!serviceToken || typeof serviceToken !== 'object') {
    return null;
  }

  const token = serviceToken as { dateCreated?: unknown; userName?: unknown };
  const userName = getSuuntoProviderUserIdFromTokenLike(token);
  if (!userName) {
    return null;
  }

  const createdAt = toDate(token.dateCreated)?.getTime() ?? 'unknown-created';

  return `${userName}:${createdAt}`;
}

export function getStableSuuntoServiceTokenSourceKey(serviceTokens: unknown): string | null {
  if (!Array.isArray(serviceTokens) || serviceTokens.length === 0) {
    return null;
  }

  const fingerprints = serviceTokens
    .map(token => buildSuuntoServiceTokenFingerprint(token))
    .filter((fingerprint): fingerprint is string => !!fingerprint)
    .sort((left, right) => left.localeCompare(right));

  return fingerprints.length > 0 ? fingerprints.join('|') : null;
}

export function getSuuntoRouteImportSourceKeyFromTokenLike(serviceToken: unknown): string | null {
  return buildSuuntoServiceTokenFingerprint(serviceToken);
}
