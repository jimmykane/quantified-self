
/**
 * Calculates the timestamp for a date N days ago from now.
 * 
 * @param days The number of days to subtract from the current time.
 * @returns The timestamp (in milliseconds) for the calculated date.
 */
export function getDaysAgoTimestamp(days: number): number {
    return Date.now() - days * 24 * 60 * 60 * 1000;
}
