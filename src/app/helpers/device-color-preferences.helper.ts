import { AppDeviceDisplaySettingsInterface } from '../models/app-user.interface';

export const DEVICE_COLOR_BY_NAME_LIMIT = 100;
export const DEVICE_COLOR_HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export function normalizeDeviceColorKey(name: unknown): string {
    if (typeof name !== 'string') {
        return '';
    }

    return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeDeviceColorValue(color: unknown): string | null {
    if (typeof color !== 'string') {
        return null;
    }

    const trimmedColor = color.trim();
    if (!DEVICE_COLOR_HEX_PATTERN.test(trimmedColor)) {
        return null;
    }

    return `#${trimmedColor.slice(1).toUpperCase()}`;
}

export function isValidDeviceColor(color: unknown): color is string {
    return normalizeDeviceColorValue(color) !== null;
}

export function normalizeDeviceColorByName(
    value: unknown,
    limit = DEVICE_COLOR_BY_NAME_LIMIT,
): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    const normalizedColors: Record<string, string> = {};
    const safeLimit = Math.max(0, Math.floor(limit));

    for (const [rawKey, rawColor] of Object.entries(value as Record<string, unknown>)) {
        if (Object.keys(normalizedColors).length >= safeLimit) {
            break;
        }

        const key = normalizeDeviceColorKey(rawKey);
        const color = normalizeDeviceColorValue(rawColor);
        if (!key || !color || normalizedColors[key]) {
            continue;
        }

        normalizedColors[key] = color;
    }

    return normalizedColors;
}

export function normalizeDeviceDisplaySettings(value: unknown): AppDeviceDisplaySettingsInterface {
    const rawSettings = value && typeof value === 'object' && !Array.isArray(value)
        ? value as { deviceColorByName?: unknown }
        : {};

    return {
        deviceColorByName: normalizeDeviceColorByName(rawSettings.deviceColorByName),
    };
}
