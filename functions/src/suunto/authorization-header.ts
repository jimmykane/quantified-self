export function toSuuntoAuthorizationHeader(accessToken: string): string {
  const trimmed = `${accessToken || ''}`.trim();
  if (trimmed.length === 0) {
    return '';
  }

  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}
