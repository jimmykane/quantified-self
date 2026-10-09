/** Stable source projection shared by browser and backend cache validation. */
export function trainingLoadTimeMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
  return typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN;
}

export function canonicalTrainingLoadValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalTrainingLoadValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, canonicalTrainingLoadValue(item)]));
  return value;
}

export function serializeTrainingLoadSource(data: { startDate?: unknown; endDate?: unknown; type?: unknown; stats?: unknown }): string {
  // Workout feedback is editable independently and is never a TSS calculation input.
  const stats = data.stats && typeof data.stats === 'object' && !Array.isArray(data.stats)
    ? Object.fromEntries(Object.entries(data.stats).filter(([key]) => key !== 'Feeling' && key !== 'Rated Perceived Exertion'))
    : data.stats ?? {};
  return JSON.stringify(canonicalTrainingLoadValue({ startMs: trainingLoadTimeMs(data.startDate),
    endMs: trainingLoadTimeMs(data.endDate), type: data.type ?? null, stats }));
}

export async function browserTrainingLoadSourceFingerprint(data: Parameters<typeof serializeTrainingLoadSource>[0]): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Training load source verification is unavailable in this browser.');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(serializeTrainingLoadSource(data)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
