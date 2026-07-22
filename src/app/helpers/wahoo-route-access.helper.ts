export const WAHOO_ROUTE_ACCESS_RECONNECT_MESSAGE = 'Reconnect Wahoo and allow route access before sending routes.';

export function isWahooRouteAccessReconnectRequired(errorOrMessage: unknown): boolean {
  const message = typeof errorOrMessage === 'string'
    ? errorOrMessage
    : (errorOrMessage as { message?: unknown } | null)?.message;

  return typeof message === 'string'
    && message.trim().toLowerCase() === WAHOO_ROUTE_ACCESS_RECONNECT_MESSAGE.toLowerCase();
}
