export const ROUTE_NAME_MAX_LENGTH = 120;

export function normalizeRouteName(rawName: unknown): string {
  return `${rawName ?? ''}`.trim().replace(/\s+/g, ' ');
}

export function validateRouteName(rawName: unknown): string {
  const routeName = normalizeRouteName(rawName);
  if (!routeName) {
    throw new Error('Route name is required.');
  }

  if (routeName.length > ROUTE_NAME_MAX_LENGTH) {
    throw new Error(`Route name must be ${ROUTE_NAME_MAX_LENGTH} characters or fewer.`);
  }

  return routeName;
}
