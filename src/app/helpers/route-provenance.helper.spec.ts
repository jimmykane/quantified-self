import { describe, expect, it } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import {
    getRouteSourceSummary,
    getRouteSyncedDestinationSummaries,
    getSuuntoRouteSendMenuLabel,
    hasRouteDeliveryForService,
} from './route-provenance.helper';

describe('route-provenance.helper', () => {
    it('builds source summaries with shared provider presentation', () => {
        const route = {
            sourceSummary: {
                sourceType: 'service_sync',
                sourceServiceName: ServiceNames.GarminAPI,
            },
        } as FirestoreRouteJSON;

        const summary = getRouteSourceSummary(route);

        expect(summary.label).toBe('Synced from Garmin');
        expect(summary.presentation?.displayLabel).toBe('Garmin');
        expect(summary.presentation?.tooltipLabel).toBe('Synced from Garmin');
    });

    it('builds destination summaries with destination branding and de-duplicates services', () => {
        const route = {
            syncedDestinationServiceNames: [
                ServiceNames.GarminAPI,
                ServiceNames.SuuntoApp,
                ServiceNames.GarminAPI,
            ],
        } as FirestoreRouteJSON;

        const summaries = getRouteSyncedDestinationSummaries(route);

        expect(summaries.map(summary => summary.label)).toEqual([
            'Sent to Garmin Connect',
            'Sent to Suunto App',
        ]);
        expect(summaries.map(summary => summary.presentation?.displayLabel)).toEqual([
            'Garmin Connect',
            'Suunto App',
        ]);
    });

    it('detects Suunto deliveries from provider-scoped delivery summaries', () => {
        const route = {
            deliverySummaries: [{
                serviceName: ServiceNames.SuuntoApp,
                providerUserIds: ['suunto-user-1'],
                latestProviderUserId: 'suunto-user-1',
            }],
        } as FirestoreRouteJSON;

        expect(hasRouteDeliveryForService(route, ServiceNames.SuuntoApp)).toBe(true);
        expect(getSuuntoRouteSendMenuLabel(route)).toBe('Send updated copy to Suunto');
    });

    it('detects legacy Suunto deliveries from destination service names', () => {
        const route = {
            syncedDestinationServiceNames: [ServiceNames.SuuntoApp],
        } as FirestoreRouteJSON;

        expect(hasRouteDeliveryForService(route, ServiceNames.SuuntoApp)).toBe(true);
        expect(getSuuntoRouteSendMenuLabel(route)).toBe('Send updated copy to Suunto');
    });

    it('keeps the first-time Suunto send label for routes without Suunto delivery state', () => {
        expect(getSuuntoRouteSendMenuLabel({} as FirestoreRouteJSON)).toBe('Suunto');
    });
});
