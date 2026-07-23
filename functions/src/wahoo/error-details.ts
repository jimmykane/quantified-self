import { WahooAPIRequestError } from './auth/api';

export interface WahooErrorLogDetails {
  name: string;
  statusCode?: number;
  providerMessage?: string;
}

const PROVIDER_ERROR_MESSAGE_MAX_LENGTH = 300;
const PROVIDER_ERROR_MESSAGE_KEYS = ['error', 'message', 'detail', 'error_description'] as const;
const WAHOO_DUPLICATE_MESSAGE_PATTERN = /\bduplicate\b|\balready\b.*\b(?:exist(?:s|ed)?|upload(?:ed)?)\b|\bpreviously uploaded\b/i;

function normalizeProviderErrorMessage(value: string): string | undefined {
  const withoutControlCharacters = [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) || 0;
      return codePoint <= 0x1F || codePoint === 0x7F ? ' ' : character;
    })
    .join('');
  const normalized = withoutControlCharacters
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return undefined;
  return normalized.slice(0, PROVIDER_ERROR_MESSAGE_MAX_LENGTH);
}

function collectProviderErrorMessages(value: unknown, depth = 0): string[] {
  if (depth > 3 || value === null || value === undefined) return [];
  if (typeof value === 'string') {
    const message = normalizeProviderErrorMessage(value);
    return message ? [message] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectProviderErrorMessages(entry, depth + 1));
  }
  if (typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  const directMessages = PROVIDER_ERROR_MESSAGE_KEYS.flatMap((key) => collectProviderErrorMessages(record[key], depth + 1));
  const nestedErrors = collectNestedProviderErrorMessages(record.errors, depth + 1);
  return [...directMessages, ...nestedErrors];
}

function collectNestedProviderErrorMessages(value: unknown, depth: number): string[] {
  if (depth > 3 || value === null || value === undefined) return [];
  if (typeof value === 'string') return collectProviderErrorMessages(value, depth);
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectNestedProviderErrorMessages(entry, depth + 1));
  }
  if (typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>)
    .flatMap((entry) => collectNestedProviderErrorMessages(entry, depth + 1));
}

/**
 * Returns a short, display-safe diagnostic from a Wahoo error response.
 * Raw provider bodies can contain unexpected data, so callers must log or
 * display only this allowlisted, length-bounded value.
 */
export function getWahooProviderErrorMessage(errorOrBody: unknown): string | undefined {
  const body = errorOrBody instanceof WahooAPIRequestError
    ? errorOrBody.responseBody
    : errorOrBody;
  const messages = collectProviderErrorMessages(body);
  return messages[0];
}

export function isWahooDuplicateMessage(errorOrBody: unknown): boolean {
  const providerMessage = getWahooProviderErrorMessage(errorOrBody);
  return !!providerMessage && WAHOO_DUPLICATE_MESSAGE_PATTERN.test(providerMessage);
}

export function isWahooDuplicateError(error: unknown): boolean {
  if (!(error instanceof WahooAPIRequestError)) return false;
  const providerMessage = getWahooProviderErrorMessage(error);
  return !!providerMessage && isWahooDuplicateMessage(error);
}

export function getWahooErrorLogDetails(error: unknown): WahooErrorLogDetails {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const name = typeof record.name === 'string' && record.name.trim()
    ? record.name.trim().slice(0, 80)
    : 'UnknownError';
  const statusCode = Number(record.statusCode);
  const baseDetails = Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    ? { name, statusCode }
    : { name };
  const providerMessage = getWahooProviderErrorMessage(error);
  return providerMessage ? { ...baseDetails, providerMessage } : baseDetails;
}

export function getWahooRetryError(error: unknown): Error {
  const details = getWahooErrorLogDetails(error);
  const status = details.statusCode ? ` (HTTP ${details.statusCode})` : '';
  return new Error(`Wahoo activity processing failed: ${details.name}${status}`);
}
