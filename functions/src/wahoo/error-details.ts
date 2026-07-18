export interface WahooErrorLogDetails {
  name: string;
  statusCode?: number;
}

export function getWahooErrorLogDetails(error: unknown): WahooErrorLogDetails {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const name = typeof record.name === 'string' && record.name.trim()
    ? record.name.trim().slice(0, 80)
    : 'UnknownError';
  const statusCode = Number(record.statusCode);
  return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    ? { name, statusCode }
    : { name };
}

export function getWahooRetryError(error: unknown): Error {
  const details = getWahooErrorLogDetails(error);
  const status = details.statusCode ? ` (HTTP ${details.statusCode})` : '';
  return new Error(`Wahoo activity processing failed: ${details.name}${status}`);
}
