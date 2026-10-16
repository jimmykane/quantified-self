import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FitBaseType, FitEncoder } from 'fit-file-parser/encoder';
import { classifyRejectedActivitySource, getNonActivitySkipReason, hasUnchangedNonActivitySources,
    sourceReferenceFingerprint } from './non-activity-sources';

const mocks = vi.hoisted(() => ({ metadata: vi.fn() }));
vi.mock('firebase-admin', () => ({ storage: () => ({ bucket: () => ({ file: () => ({ getMetadata: mocks.metadata }) }) }) }));
const rejection = new Error('FIT file is not an activity file');
function fit(types: number[], session = false): Buffer {
    const encoder = new FitEncoder({ protocolVersion: 0x20 });
    types.forEach(type => encoder.writeMessage(0, [{ number: 0, size: 1, baseType: FitBaseType.Enum, value: type }]));
    if (session) encoder.writeMessage(18, [{ number: 5, size: 1, baseType: FitBaseType.Enum, value: 2 }], 1);
    return Buffer.from(encoder.close());
}

describe('non-activity reparse sources', () => {
    beforeEach(() => vi.clearAllMocks());
    it.each([15, 28, 32])('recognizes declared monitoring type %i', async type => {
        expect(await classifyRejectedActivitySource(fit([type]), 'source.fit.gz', rejection)).toBe('monitoring');
    });
    it('keeps numeric type 49 separate from monitoring', async () => {
        expect(await classifyRejectedActivitySource(fit([49]), 'source.fit', rejection)).toBe('other_non_activity');
    });
    it.each([[4], [20], [], [4, 32], [32, 49]].map(types => [types]))('does not skip absent, activity or conflicting declarations %j', async types => {
        expect(await classifyRejectedActivitySource(fit(types), 'source.fit', rejection)).toBeNull();
    });
    it('does not hide corrupt files, session contradictions or unrelated parser errors', async () => {
        const corrupted = fit([32]); corrupted[corrupted.length - 1] ^= 0xff;
        expect(await classifyRejectedActivitySource(corrupted, 'source.fit', rejection)).toBeNull();
        expect(await classifyRejectedActivitySource(fit([32], true), 'source.fit', rejection)).toBeNull();
        expect(await classifyRejectedActivitySource(fit([32]), 'source.fit', new Error('bad dates'))).toBeNull();
        expect(await classifyRejectedActivitySource(fit([32]), 'source.json', rejection)).toBeNull();
    });
    it('recognizes a valid FIT course with a lap summary without treating it as a workout', async () => {
        const encoder = new FitEncoder({ protocolVersion: 0x20 });
        encoder.writeMessage(0, [{ number: 0, size: 1, baseType: FitBaseType.Enum, value: 6 }]);
        encoder.writeMessage(19, [{ number: 9, size: 4, baseType: FitBaseType.Uint32, value: 10000 }], 1);
        for (let i = 0; i < 2; i++) encoder.writeMessage(20, [
            { number: 0, size: 4, baseType: FitBaseType.Sint32, value: 1000000 + i * 10000 },
            { number: 1, size: 4, baseType: FitBaseType.Sint32, value: 2000000 + i * 10000 },
        ], 2);
        expect(await classifyRejectedActivitySource(Buffer.from(encoder.close()), 'course.fit', rejection)).toBe('route');
        encoder.writeMessage(18, [{ number: 5, size: 1, baseType: FitBaseType.Enum, value: 2 }], 3);
        expect(await classifyRejectedActivitySource(Buffer.from(encoder.close()), 'course.fit', rejection)).toBeNull();
    });

    it('requires usable route geometry before treating a course as a route', async () => {
        expect(await classifyRejectedActivitySource(fit([6]), 'source.fit', rejection)).toBeNull();
        const gpx = Buffer.from('<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><rte><rtept lat="50" lon="10"/><rtept lat="50.01" lon="10.01"/></rte></gpx>');
        expect(await classifyRejectedActivitySource(gpx, 'source.gpx',
            new Error('No activities found in GPX; use importRoutesFromGPX for routes'))).toBe('route');
    });
    it('separates route, monitoring and mixed-source review outcomes', () => {
        expect(getNonActivitySkipReason(['monitoring'])).toBe('MONITORING_SOURCE');
        expect(getNonActivitySkipReason(['route', 'route'])).toBe('ROUTE_SOURCE');
        expect(getNonActivitySkipReason(['route', 'monitoring'])).toBe('MIXED_SOURCES_REQUIRING_REVIEW');
        expect(getNonActivitySkipReason(['activity', 'monitoring'])).toBe('MIXED_SOURCES_REQUIRING_REVIEW');
    });
    it('reuses classification across versions only for matching references and live generations', async () => {
        const sources = [{ path: 'source.fit', bucket: 'bucket' }];
        const status = { status: 'skipped', reason: 'MONITORING_SOURCE', targetSportsLibVersion: '1.0.0',
            nonActivitySources: { schemaVersion: 1, sourceFingerprint: sourceReferenceFingerprint(sources),
                sources: [{ ...sources[0], referenceBucket: 'bucket', generation: '1', md5: 'checksum', kind: 'monitoring', sha256: 'hash' }] } };
        mocks.metadata.mockResolvedValue([{ generation: '1', md5Hash: 'checksum' }]);
        expect(await hasUnchangedNonActivitySources(status, sources)).toBe(true);
        expect(await hasUnchangedNonActivitySources(status, [{ path: 'replacement.fit' }])).toBe(false);
        expect(await hasUnchangedNonActivitySources(status, [...sources, ...sources])).toBe(false);
        mocks.metadata.mockResolvedValue([{ generation: '2', md5Hash: 'checksum' }]);
        expect(await hasUnchangedNonActivitySources(status, sources)).toBe(false);
        mocks.metadata.mockResolvedValue([{ generation: '1', md5Hash: 'changed' }]);
        expect(await hasUnchangedNonActivitySources(status, sources)).toBe(false);
        mocks.metadata.mockRejectedValue(new Error('not found'));
        expect(await hasUnchangedNonActivitySources(status, sources)).toBe(false);
    });
    it('invalidates fallback classifications when the preferred bucket gains an original', async () => {
        const sources = [{ path: 'source.fit', bucket: 'preferred' }];
        const status = { status: 'skipped', reason: 'MONITORING_SOURCE', nonActivitySources: {
            schemaVersion: 1, sourceFingerprint: sourceReferenceFingerprint(sources), sources: [{
                path: 'source.fit', referenceBucket: 'preferred', bucket: 'quantified-self-io',
                generation: '1', md5: 'checksum', sha256: 'hash', kind: 'monitoring',
            }],
        } };
        mocks.metadata.mockRejectedValueOnce({ code: 404 }).mockResolvedValueOnce([{ generation: '1', md5Hash: 'checksum' }]);
        expect(await hasUnchangedNonActivitySources(status, sources)).toBe(true);
        mocks.metadata.mockResolvedValue([{ generation: 'new', md5Hash: 'replacement' }]);
        expect(await hasUnchangedNonActivitySources(status, sources)).toBe(false);
        mocks.metadata.mockRejectedValue({ code: 503 });
        expect(await hasUnchangedNonActivitySources(status, sources)).toBe(false);
    });

    it('does no storage work for normal statuses or incomplete evidence', async () => {
        expect(await hasUnchangedNonActivitySources({ status: 'completed' }, [{ path: 'source.fit' }])).toBe(false);
        expect(await hasUnchangedNonActivitySources({ status: 'skipped', reason: 'MONITORING_SOURCE' }, [{ path: 'source.fit' }])).toBe(false);
        expect(mocks.metadata).not.toHaveBeenCalled();
    });
});
