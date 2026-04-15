/**
 * Normalizes error messages by replacing dynamic values (numbers, IDs) with placeholders.
 * This allows similar errors with different dynamic data to be clustered together.
 */
export function normalizeError(error: string): string {
    return error
        .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '#')
        .replace(/[0-9a-fA-F]{24,}/g, '#')
        .replace(/\d+/g, '#');
}
