import {
  isWahooRouteAccessReconnectRequired,
  WAHOO_ROUTE_ACCESS_RECONNECT_MESSAGE,
} from './wahoo-route-access.helper';

describe('wahoo route access helper', () => {
  it('recognizes the Wahoo route-access reconnect message', () => {
    expect(isWahooRouteAccessReconnectRequired(WAHOO_ROUTE_ACCESS_RECONNECT_MESSAGE)).toBe(true);
    expect(isWahooRouteAccessReconnectRequired(new Error(`  ${WAHOO_ROUTE_ACCESS_RECONNECT_MESSAGE}  `))).toBe(true);
  });

  it('does not treat unrelated Wahoo and route errors as a reconnect requirement', () => {
    expect(isWahooRouteAccessReconnectRequired('Wahoo rejected the route upload: A route already exists.')).toBe(false);
    expect(isWahooRouteAccessReconnectRequired({ message: 'Connect Wahoo again before sending routes.' })).toBe(false);
    expect(isWahooRouteAccessReconnectRequired(undefined)).toBe(false);
  });
});
