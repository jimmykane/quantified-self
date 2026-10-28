/** Server-owned provenance. The activity document ID stays stable across source revisions. */
export interface ActivitySourceIdentity {
  version: 1;
  activityId: string;
  startMs: number;
  endMs: number;
  importedType: string;
}

export function readActivitySourceIdentity(value: unknown, activityId?: string | null): ActivitySourceIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.version !== 1 || typeof source.activityId !== 'string' || !source.activityId || source.activityId.length > 256
    || source.activityId.includes('/') || (activityId != null && source.activityId !== activityId)
    || typeof source.startMs !== 'number' || !Number.isFinite(source.startMs)
    || typeof source.endMs !== 'number' || !Number.isFinite(source.endMs) || source.endMs < source.startMs
    || typeof source.importedType !== 'string' || !source.importedType.trim() || source.importedType.length > 120) return null;
  return { version: 1, activityId: source.activityId, startMs: source.startMs,
    endMs: source.endMs, importedType: source.importedType };
}

/** Called only after a reader has established a unique source match and assigned the saved ID. */
export function carryActivitySourceIdentity(existing: {
  getID(): string | null | undefined; sourceIdentity?: unknown;
}, parsed: { getID(): string | null | undefined; type: unknown; sourceIdentity?: unknown }): void {
  const source = readActivitySourceIdentity(existing.sourceIdentity, existing.getID());
  if (!source || parsed.getID() !== source.activityId) return;
  parsed.sourceIdentity = { ...source, importedType: `${parsed.type}` };
}
