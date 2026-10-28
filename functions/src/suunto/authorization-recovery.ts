/** Application subscription access is separate from the user's OAuth grant.
 * Inspect only the known APIM signature, never retain or log provider text. */
export function isSuuntoSubscriptionKeyRejection(status: unknown, body: unknown, challenge?: unknown): boolean {
  if (status !== 401 && status !== 403) return false;
  if (typeof challenge === 'string' && /^AzureApiManagementKey(?:\s|$)/i.test(challenge.trim())) return true;
  if (typeof body === 'string') {
    if (body.length > 8 * 1024) return false;
    try { body = JSON.parse(body); } catch { return false; }
  }
  if (!body || typeof body !== 'object') return false;
  const data = body as { statusCode?: unknown; message?: unknown };
  return (data.statusCode === 401 || data.statusCode === 403) && typeof data.message === 'string'
    && /^Access denied due to (?:invalid|missing) subscription key\.(?:\s|$)/.test(data.message);
}

/** Only use for an OAuth-authenticated resource request, never the token
 * endpoint, a signed blob URL, or our own webhook/callable authorization. */
export function isSuuntoOAuthRejection(error: unknown): boolean {
  const value = error as {
    statusCode?: unknown;
    response?: { statusCode?: unknown; headers?: Record<string, unknown> };
    error?: { error?: unknown };
    providerCode?: unknown;
  } | null;
  const status = value?.statusCode ?? value?.response?.statusCode;
  if (value?.providerCode === 'subscription_key_rejected'
    || isSuuntoSubscriptionKeyRejection(status, value?.error, value?.response?.headers?.['www-authenticate'])) return false;
  return status === 401 || status === 403 || value?.error?.error === 'invalid_grant';
}
