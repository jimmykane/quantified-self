import { getBenchmarkPairKey } from '../../../shared/app-event.interface';

export interface BenchmarkReparseIdentity {
    activityIDRemap: ReadonlyMap<string, string>;
    currentActivityIDs: ReadonlySet<string>;
}

const COMPARISON_FIELDS = [
    'isBenchmark', 'hasBenchmark', 'benchmarkDevices', 'benchmarkLatestAt',
    'toolSource', 'comparisonTitle', 'sourceFilesCount', 'activitiesCount', 'benchmarkStatus',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Preserve the live document's comparison data, never a pre-parse snapshot of a user's report. */
export function preserveBenchmarkMetadataOnReparse(
    incoming: Record<string, unknown>,
    existing: Record<string, unknown>,
    identity: BenchmarkReparseIdentity,
): Record<string, unknown> {
    const result = { ...incoming };
    // Any workout may acquire its first report while reparse is in progress.
    const revision = Number.isSafeInteger(existing.benchmarkSourceRevision) && Number(existing.benchmarkSourceRevision) >= 0
        ? Number(existing.benchmarkSourceRevision) : 0;
    result.benchmarkSourceRevision = revision + 1;
    for (const field of COMPARISON_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(existing, field)) result[field] = existing[field];
    }

    const remap = (report: Record<string, unknown>): Record<string, unknown> => {
        const reference = typeof report.referenceId === 'string' ? report.referenceId : '';
        const test = typeof report.testId === 'string' ? report.testId : '';
        const resolveID = (id: string) => {
            const mapped = identity.activityIDRemap.get(id);
            return mapped && identity.currentActivityIDs.has(mapped) ? mapped : undefined;
        };
        const referenceId = resolveID(reference);
        const testId = resolveID(test);
        const resolved = !!referenceId && !!testId && referenceId !== testId;
        return {
            ...report,
            ...(resolved ? { referenceId, testId } : {}),
            requiresRegeneration: true,
            activityLinksResolved: resolved,
        };
    };

    if (isRecord(existing.benchmarkResults)) {
        const reports: Record<string, unknown> = Object.create(null);
        for (const [oldKey, value] of Object.entries(existing.benchmarkResults)) {
            if (!isRecord(value)) {
                reports[oldKey] = value;
                continue;
            }
            const report = remap(value);
            let key = report.activityLinksResolved
                ? getBenchmarkPairKey(report.referenceId as string, report.testId as string) : oldKey;
            // Preserve every historical entry even if an older document contains duplicate pair aliases.
            while (Object.prototype.hasOwnProperty.call(reports, key)) key = `historical:${key}`;
            reports[key] = report;
        }
        result.benchmarkResults = reports;
    }
    if (isRecord(existing.benchmarkResult)) result.benchmarkResult = remap(existing.benchmarkResult);
    return result;
}
