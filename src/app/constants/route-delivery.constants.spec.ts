import { describe, expect, it } from 'vitest';

import { SHOW_GARMIN_ROUTE_SEND } from './route-delivery.constants';

describe('route delivery constants', () => {
  it('keeps Garmin saved-route sending visible', () => {
    expect(SHOW_GARMIN_ROUTE_SEND).toBe(true);
  });
});
