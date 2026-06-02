export const EMAIL_LINK_RETURN_URL_STORAGE_KEY = 'emailLinkReturnUrl';

export function sanitizeLocalAuthRedirectUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return null;
  }

  if (/^\/login(?:[/?#]|$)/.test(trimmed)) {
    return null;
  }

  return trimmed;
}
