export const TOOL_COMPARISON_EVENT_ID_HEADER = 'X-Tool-Comparison-Event-ID';

const TOOL_COMPARISON_EVENT_ID_SEED = 'benchmark-comparison';
const TOOL_COMPARISON_HASH_SEPARATOR = ':';
const TOOL_COMPARISON_EVENT_ID_PATTERN = /^[a-f0-9]{64}$/;

export type ToolComparisonHashPart<TBytes> = string | TBytes;

export function getToolComparisonBaseExtension(extension: string): string {
    const normalized = extension.trim().toLowerCase();
    return normalized.endsWith('.gz') ? normalized.slice(0, -3) : normalized;
}

export function normalizeToolComparisonEventIDHint(value?: string | null): string | null {
    const trimmed = value?.trim().toLowerCase();
    return trimmed && TOOL_COMPARISON_EVENT_ID_PATTERN.test(trimmed) ? trimmed : null;
}

export function buildToolComparisonContentHashParts<TBytes>(
    extension: string,
    payloadForParsing: TBytes,
): Array<ToolComparisonHashPart<TBytes>> {
    return [
        getToolComparisonBaseExtension(extension),
        TOOL_COMPARISON_HASH_SEPARATOR,
        payloadForParsing,
    ];
}

export function buildToolComparisonEventIDHashParts(contentOwnerUserID: string, contentHashes: readonly string[]): string[] {
    const parts = [
        TOOL_COMPARISON_EVENT_ID_SEED,
        TOOL_COMPARISON_HASH_SEPARATOR,
        contentOwnerUserID,
    ];

    for (const contentHash of [...contentHashes].sort()) {
        parts.push(TOOL_COMPARISON_HASH_SEPARATOR, contentHash);
    }

    return parts;
}
