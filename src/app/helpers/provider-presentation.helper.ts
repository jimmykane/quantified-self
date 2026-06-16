import { EventInterface, ServiceNames } from '@sports-alliance/sports-lib';
import { AppEventInterface } from '@shared/app-event.interface';
import {
    buildProviderPresentation,
    getProviderDisplayName,
    ProviderPresentation,
} from '@shared/provider-presentation';

function normalizeNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function resolveActivityDeviceName(activity: unknown): string | null {
    const creator = (activity as { creator?: { name?: unknown; devices?: unknown[] } } | null)?.creator;
    const creatorName = normalizeNonEmptyString(creator?.name);
    if (creatorName && creatorName.toLowerCase() !== 'garmin') {
        return creatorName;
    }

    if (!Array.isArray(creator?.devices)) {
        return null;
    }

    for (const device of creator.devices) {
        const deviceName = normalizeNonEmptyString((device as { name?: unknown }).name)
            || normalizeNonEmptyString((device as { manufacturer?: unknown }).manufacturer)
            || normalizeNonEmptyString((device as { type?: unknown }).type);
        if (deviceName) {
            return deviceName;
        }
    }

    return null;
}

function resolveGarminDeviceNamesFromActivities(event: EventInterface | null | undefined): string[] {
    const sourceEvent = event as (EventInterface & { getActivities?: () => unknown[] }) | null | undefined;
    if (!sourceEvent || typeof sourceEvent.getActivities !== 'function') {
        return [];
    }

    try {
        const activities = Array.isArray(sourceEvent.getActivities()) ? sourceEvent.getActivities() : [];
        const uniqueNames = new Set<string>();
        activities.forEach((activity) => {
            const deviceName = resolveActivityDeviceName(activity);
            if (deviceName) {
                uniqueNames.add(deviceName);
            }
        });
        return [...uniqueNames.values()];
    } catch {
        return [];
    }
}

function resolveGarminDeviceNamesFromEventSummary(event: EventInterface | null | undefined): string[] {
    const sourceEvent = event as (AppEventInterface & { getDeviceNamesAsString?: () => string }) | null | undefined;
    if (!sourceEvent || typeof sourceEvent.getDeviceNamesAsString !== 'function') {
        return [];
    }

    try {
        const rawNames = normalizeNonEmptyString(sourceEvent.getDeviceNamesAsString());
        if (!rawNames) {
            return [];
        }

        return rawNames
            .split(',')
            .map(name => normalizeNonEmptyString(name))
            .filter((name): name is string => !!name);
    } catch {
        return [];
    }
}

function resolveSingleGarminDeviceLabel(event: EventInterface | null | undefined): string | null {
    const activityDeviceNames = resolveGarminDeviceNamesFromActivities(event);
    if (activityDeviceNames.length === 1) {
        return activityDeviceNames[0];
    }
    if (activityDeviceNames.length > 1) {
        return null;
    }

    const eventDeviceNames = resolveGarminDeviceNamesFromEventSummary(event);
    return eventDeviceNames.length === 1 ? eventDeviceNames[0] : null;
}

function formatGarminSourceLabel(deviceLabel: string | null): string {
    const normalizedDeviceLabel = normalizeNonEmptyString(deviceLabel);
    if (!normalizedDeviceLabel) {
        return getProviderDisplayName(ServiceNames.GarminAPI, 'source');
    }

    return /^garmin\b/i.test(normalizedDeviceLabel)
        ? normalizedDeviceLabel
        : `Garmin ${normalizedDeviceLabel}`;
}

export function buildSourceProviderPresentation(
    serviceName: ServiceNames | null,
    event?: EventInterface | null,
): ProviderPresentation | null {
    if (!serviceName) {
        return null;
    }

    const sourceDetailLabel = serviceName === ServiceNames.GarminAPI
        ? resolveSingleGarminDeviceLabel(event)
        : null;
    const displayLabel = serviceName === ServiceNames.GarminAPI
        ? formatGarminSourceLabel(sourceDetailLabel)
        : getProviderDisplayName(serviceName, 'source');

    return buildProviderPresentation({
        serviceName,
        mode: 'source',
        displayLabel,
        tooltipLabel: `Synced from ${displayLabel}`,
        exportLabel: displayLabel,
        sourceDetailLabel,
    });
}

export function buildDestinationProviderPresentation(serviceName: ServiceNames | null): ProviderPresentation | null {
    if (!serviceName) {
        return null;
    }

    const displayLabel = getProviderDisplayName(serviceName, 'destination');
    return buildProviderPresentation({
        serviceName,
        mode: 'destination',
        displayLabel,
        tooltipLabel: displayLabel,
        exportLabel: displayLabel,
    });
}
