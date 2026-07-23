import { ServiceNames } from '@sports-alliance/sports-lib';

export type ProviderPresentationMode = 'source' | 'destination';

export type ProviderIconKey = 'garmin' | 'suunto' | 'coros' | 'wahoo';

export type ProviderBrandingVariant =
    | 'garmin'
    | 'garmin-connect'
    | 'suunto'
    | 'suunto-app'
    | 'coros'
    | 'wahoo';

export interface ProviderPresentation {
    serviceName: ServiceNames;
    mode: ProviderPresentationMode;
    displayLabel: string;
    tooltipLabel: string;
    exportLabel: string;
    iconKey: ProviderIconKey;
    brandingVariant: ProviderBrandingVariant;
    sourceDetailLabel?: string | null;
}

interface BuildProviderPresentationParams {
    serviceName: ServiceNames | null;
    mode: ProviderPresentationMode;
    displayLabel?: string | null;
    tooltipLabel?: string | null;
    exportLabel?: string | null;
    sourceDetailLabel?: string | null;
}

const SOURCE_PROVIDER_LABELS: Record<ServiceNames, string> = {
    [ServiceNames.GarminAPI]: 'Garmin',
    [ServiceNames.SuuntoApp]: 'Suunto',
    [ServiceNames.COROSAPI]: 'COROS',
    [ServiceNames.WahooAPI]: 'Wahoo',
};

const DESTINATION_PROVIDER_LABELS: Record<ServiceNames, string> = {
    [ServiceNames.GarminAPI]: 'Garmin Connect',
    [ServiceNames.SuuntoApp]: 'Suunto App',
    [ServiceNames.COROSAPI]: 'COROS',
    [ServiceNames.WahooAPI]: 'Wahoo',
};

const PROVIDER_ICON_KEYS: Record<ServiceNames, ProviderIconKey> = {
    [ServiceNames.GarminAPI]: 'garmin',
    [ServiceNames.SuuntoApp]: 'suunto',
    [ServiceNames.COROSAPI]: 'coros',
    [ServiceNames.WahooAPI]: 'wahoo',
};

const SOURCE_BRANDING_VARIANTS: Record<ServiceNames, ProviderBrandingVariant> = {
    [ServiceNames.GarminAPI]: 'garmin',
    [ServiceNames.SuuntoApp]: 'suunto',
    [ServiceNames.COROSAPI]: 'coros',
    [ServiceNames.WahooAPI]: 'wahoo',
};

const DESTINATION_BRANDING_VARIANTS: Record<ServiceNames, ProviderBrandingVariant> = {
    [ServiceNames.GarminAPI]: 'garmin-connect',
    [ServiceNames.SuuntoApp]: 'suunto-app',
    [ServiceNames.COROSAPI]: 'coros',
    [ServiceNames.WahooAPI]: 'wahoo',
};

function normalizeNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function normalizeProviderServiceName(serviceName: unknown): ServiceNames | null {
    switch (serviceName) {
        case ServiceNames.GarminAPI:
        case ServiceNames.SuuntoApp:
        case ServiceNames.COROSAPI:
        case ServiceNames.WahooAPI:
            return serviceName;
        default:
            return null;
    }
}

export function getUnknownProviderDisplayName(serviceName: unknown): string {
    const normalized = normalizeNonEmptyString(serviceName);
    if (!normalized) {
        return 'service';
    }

    return normalized
        .replace(/\bAPI\b/gi, '')
        .replace(/\bApp\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function getProviderDisplayName(
    serviceName: ServiceNames | string | null | undefined,
    mode: ProviderPresentationMode = 'source',
): string {
    const normalizedServiceName = normalizeProviderServiceName(serviceName);
    if (!normalizedServiceName) {
        return getUnknownProviderDisplayName(serviceName);
    }

    return mode === 'destination'
        ? DESTINATION_PROVIDER_LABELS[normalizedServiceName]
        : SOURCE_PROVIDER_LABELS[normalizedServiceName];
}

export function getProviderIconKey(serviceName: ServiceNames | string | null | undefined): ProviderIconKey | null {
    const normalizedServiceName = normalizeProviderServiceName(serviceName);
    return normalizedServiceName ? PROVIDER_ICON_KEYS[normalizedServiceName] : null;
}

export function getProviderBrandingVariant(
    serviceName: ServiceNames | string | null | undefined,
    mode: ProviderPresentationMode = 'source',
): ProviderBrandingVariant | null {
    const normalizedServiceName = normalizeProviderServiceName(serviceName);
    if (!normalizedServiceName) {
        return null;
    }

    return mode === 'destination'
        ? DESTINATION_BRANDING_VARIANTS[normalizedServiceName]
        : SOURCE_BRANDING_VARIANTS[normalizedServiceName];
}

export function buildProviderPresentation(params: BuildProviderPresentationParams): ProviderPresentation | null {
    const normalizedServiceName = normalizeProviderServiceName(params.serviceName);
    if (!normalizedServiceName) {
        return null;
    }

    const displayLabel = normalizeNonEmptyString(params.displayLabel)
        || getProviderDisplayName(normalizedServiceName, params.mode);
    const tooltipLabel = normalizeNonEmptyString(params.tooltipLabel)
        || displayLabel;
    const exportLabel = normalizeNonEmptyString(params.exportLabel)
        || displayLabel;
    const iconKey = getProviderIconKey(normalizedServiceName);
    const brandingVariant = getProviderBrandingVariant(normalizedServiceName, params.mode);

    if (!iconKey || !brandingVariant) {
        return null;
    }

    return {
        serviceName: normalizedServiceName,
        mode: params.mode,
        displayLabel,
        tooltipLabel,
        exportLabel,
        iconKey,
        brandingVariant,
        sourceDetailLabel: normalizeNonEmptyString(params.sourceDetailLabel),
    };
}
