import { describe, expect, it } from 'vitest';

import {
    SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS,
    buildSportsLibRouteReparseJobId,
    extractPrimaryRouteSourceFile,
    parseUidAndRouteIdFromRoutePath,
    shouldRouteBeReparsed,
} from './sports-lib-route-reparse.service';

function makeRouteRef(processingSnapshot: { exists: boolean; data?: () => Record<string, unknown> }) {
    return {
        path: 'users/user-1/routes/route-1',
        collection: () => ({
            doc: () => ({
                get: async () => processingSnapshot,
            }),
        }),
    } as any;
}

describe('sports-lib-route-reparse.service', () => {
    it('enables the route reparse scanner by default', () => {
        expect(SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS.enabled).toBe(true);
        expect(SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS.uidAllowlist).toEqual([]);
    });

    it('builds deterministic route reparse job IDs', () => {
        expect(buildSportsLibRouteReparseJobId('user-1', 'route-1', '16.0.2')).toBe(
            buildSportsLibRouteReparseJobId('user-1', 'route-1', '16.0.2'),
        );
        expect(buildSportsLibRouteReparseJobId('user-1', 'route-2', '16.0.2')).not.toBe(
            buildSportsLibRouteReparseJobId('user-1', 'route-1', '16.0.2'),
        );
    });

    it('parses route document paths', () => {
        expect(parseUidAndRouteIdFromRoutePath('users/user-1/routes/route-1')).toEqual({
            uid: 'user-1',
            routeId: 'route-1',
        });
        expect(parseUidAndRouteIdFromRoutePath('users/user-1/events/event-1')).toBeNull();
        expect(parseUidAndRouteIdFromRoutePath('users/user-1/routes')).toBeNull();
    });

    it('extracts the primary route source from originalFiles before legacy originalFile', () => {
        expect(extractPrimaryRouteSourceFile({
            originalFiles: [
                { path: '' },
                { path: 'users/user-1/routes/route-1/source.gpx', bucket: 'route-bucket' },
            ],
            originalFile: { path: 'legacy.gpx' },
        } as any)).toEqual({
            path: 'users/user-1/routes/route-1/source.gpx',
            bucket: 'route-bucket',
        });
        expect(extractPrimaryRouteSourceFile({
            originalFile: { path: 'legacy.gpx' },
        } as any)).toEqual({ path: 'legacy.gpx' });
        expect(extractPrimaryRouteSourceFile({ originalFiles: [] } as any)).toBeNull();
    });

    it('marks routes for reparse when processing metadata is missing, malformed, or stale', async () => {
        await expect(shouldRouteBeReparsed(makeRouteRef({ exists: false }), '16.0.2')).resolves.toBe(true);
        await expect(shouldRouteBeReparsed(makeRouteRef({
            exists: true,
            data: () => ({ sportsLibVersion: 'not-semver' }),
        }), '16.0.2')).resolves.toBe(true);
        await expect(shouldRouteBeReparsed(makeRouteRef({
            exists: true,
            data: () => ({ sportsLibVersion: '16.0.1' }),
        }), '16.0.2')).resolves.toBe(true);
        await expect(shouldRouteBeReparsed(makeRouteRef({
            exists: true,
            data: () => ({ sportsLibVersion: '16.0.2' }),
        }), '16.0.2')).resolves.toBe(false);
    });
});
