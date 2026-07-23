import { describe, expect, it } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { buildDestinationProviderPresentation, buildSourceProviderPresentation } from './provider-presentation.helper';

describe('provider-presentation.helper', () => {
    it('builds a Garmin source label with a single clear device model', () => {
        const presentation = buildSourceProviderPresentation(ServiceNames.GarminAPI, {
            getActivities: () => [{ creator: { name: 'Edge 540' } }],
        } as any);

        expect(presentation?.displayLabel).toBe('Garmin Edge 540');
        expect(presentation?.tooltipLabel).toBe('Synced from Garmin Edge 540');
        expect(presentation?.brandingVariant).toBe('garmin');
    });

    it('falls back to Garmin when multiple device labels exist', () => {
        const presentation = buildSourceProviderPresentation(ServiceNames.GarminAPI, {
            getActivities: () => [
                { creator: { name: 'Edge 540' } },
                { creator: { name: 'Forerunner 965' } },
            ],
        } as any);

        expect(presentation?.displayLabel).toBe('Garmin');
        expect(presentation?.tooltipLabel).toBe('Synced from Garmin');
    });

    it('keeps Suunto, COROS, and Wahoo source branding simple', () => {
        expect(buildSourceProviderPresentation(ServiceNames.SuuntoApp)?.displayLabel).toBe('Suunto');
        expect(buildSourceProviderPresentation(ServiceNames.COROSAPI)?.displayLabel).toBe('COROS');
        expect(buildSourceProviderPresentation(ServiceNames.WahooAPI)?.displayLabel).toBe('Wahoo');
    });

    it('uses destination branding for connected-provider surfaces', () => {
        expect(buildDestinationProviderPresentation(ServiceNames.GarminAPI)?.displayLabel).toBe('Garmin Connect');
        expect(buildDestinationProviderPresentation(ServiceNames.SuuntoApp)?.displayLabel).toBe('Suunto App');
        expect(buildDestinationProviderPresentation(ServiceNames.COROSAPI)?.displayLabel).toBe('COROS');
        expect(buildDestinationProviderPresentation(ServiceNames.WahooAPI)?.displayLabel).toBe('Wahoo');
    });
});
