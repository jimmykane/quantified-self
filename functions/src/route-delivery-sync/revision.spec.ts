import { describe, expect, it } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  buildRouteDeliverySourceRevisionKey,
  buildRouteDeliverySourceRevisionKeyForRouteSource,
} from './revision';

describe('route-delivery-sync/revision', () => {
  it('builds stable keys from source, provider route, and modified timestamp', () => {
    expect(buildRouteDeliverySourceRevisionKey({
      sourceServiceName: ServiceNames.SuuntoApp,
      providerRouteId: 'suunto-route-1',
      providerRouteModifiedAt: new Date('2026-02-01T12:00:00.000Z'),
      fallbackUpdatedAt: new Date('2026-02-02T12:00:00.000Z'),
      fallbackRouteID: 'route-1',
    })).toBe(`${ServiceNames.SuuntoApp}:suunto-route-1:1769947200000`);
  });

  it('falls back to persisted route timestamps instead of unsaved provider-created timestamps', () => {
    expect(buildRouteDeliverySourceRevisionKey({
      sourceServiceName: ServiceNames.SuuntoApp,
      providerRouteId: 'suunto-route-1',
      fallbackUpdatedAt: { seconds: 1769947200, nanoseconds: 0 },
      fallbackRouteID: 'route-1',
    })).toBe(`${ServiceNames.SuuntoApp}:suunto-route-1:1769947200000`);
  });

  it('prefers source import timestamps over route document timestamps for source revision identity', () => {
    expect(buildRouteDeliverySourceRevisionKeyForRouteSource({
      sourceServiceName: ServiceNames.SuuntoApp,
      sourceSummary: {
        providerRouteId: 'suunto-route-1',
        importedAt: '2026-02-01T12:00:00.000Z',
      },
      routeImportedAt: '2026-02-03T12:00:00.000Z',
      fallbackRouteID: 'route-1',
    })).toBe(`${ServiceNames.SuuntoApp}:suunto-route-1:1769947200000`);
  });
});
