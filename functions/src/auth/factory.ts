import { ServiceNames } from '@sports-alliance/sports-lib';
import { ServiceAuthAdapter } from './ServiceAuthAdapter';
import { GarminAuthAdapter } from '../garmin/auth/adapter';
import { SuuntoAuthAdapter } from '../suunto/auth/adapter';
import { COROSAuthAdapter } from '../coros/auth/adapter';

/**
 * Factory for retrieving the appropriate ServiceAuthAdapter for a given service.
 */
export function getServiceAdapter(serviceName: ServiceNames, refresh = false): ServiceAuthAdapter {
    switch (serviceName) {
        case ServiceNames.GarminAPI:
            return new GarminAuthAdapter();
        case ServiceNames.SuuntoApp:
            return new SuuntoAuthAdapter();
        case ServiceNames.COROSAPI:
            return new COROSAuthAdapter();
        default:
            throw new Error(`Auth adapter not implemented for service: ${serviceName}`);
    }
}
