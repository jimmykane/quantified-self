import { describe, expect, it } from 'vitest';

import {
  buildSuuntoRouteCatchUpPromptSource,
  buildSuuntoRouteCatchUpPromptViewModel,
  buildSuuntoRouteCatchUpSnackbarMessage,
  getSuuntoConnectedProviderUserIds,
  getSuuntoRouteCatchUpCount,
  getSuuntoRouteCatchUpDate,
  getSuuntoRouteCatchUpDateForConnectedProviders,
} from './suunto-route-catch-up.helper';

describe('suunto-route-catch-up.helper', () => {
  it('parses route catch-up dates from supported timestamp shapes', () => {
    expect(getSuuntoRouteCatchUpDate(1710000000000)?.getTime()).toBe(1710000000000);
    expect(getSuuntoRouteCatchUpDate(new Date('2026-06-10T09:00:00.000Z'))?.toISOString()).toBe('2026-06-10T09:00:00.000Z');
    expect(getSuuntoRouteCatchUpDate({
      toDate: () => new Date('2026-06-11T10:30:00.000Z'),
    })?.toISOString()).toBe('2026-06-11T10:30:00.000Z');
    expect(getSuuntoRouteCatchUpDate({
      seconds: 1710000000,
      nanoseconds: 500000000,
    })?.getTime()).toBe(1710000000500);
    expect(getSuuntoRouteCatchUpDate('not-a-date')).toBeNull();
  });

  it('normalizes route catch-up counts', () => {
    expect(getSuuntoRouteCatchUpCount(7)).toBe(7);
    expect(getSuuntoRouteCatchUpCount(undefined)).toBe(0);
    expect(getSuuntoRouteCatchUpCount('7')).toBe(0);
  });

  it('normalizes connected Suunto provider user ids from service tokens', () => {
    expect(getSuuntoConnectedProviderUserIds([
      { userName: 'beta' },
      { userName: 'alpha' },
      { userName: 'beta' },
      { userName: '   ' },
      {},
    ])).toEqual(['alpha', 'beta']);
  });

  it('requires a route catch-up completion marker for every connected Suunto account', () => {
    const serviceTokens = [
      { userName: 'alpha', dateCreated: 1700000000000 },
      { userName: 'beta', dateCreated: 1710000000000 },
    ];

    expect(getSuuntoRouteCatchUpDateForConnectedProviders({
      routeImportStatesByProviderUserId: {
        alpha: { didLastRouteImport: 1710000000000 },
      },
      didLastRouteImport: 1710000000000,
    }, serviceTokens)).toBeNull();

    expect(getSuuntoRouteCatchUpDateForConnectedProviders({
      routeImportStatesByProviderUserId: {
        alpha: { didLastRouteImport: 1710000000000 },
        beta: {
          didLastRouteImport: {
            toDate: () => new Date('2026-06-12T08:45:00.000Z'),
          },
        },
      },
    }, serviceTokens)?.toISOString()).toBe('2026-06-12T08:45:00.000Z');

    expect(getSuuntoRouteCatchUpDateForConnectedProviders({
      didLastRouteImport: 1710000000000,
    }, serviceTokens)).toBeNull();
  });

  it('falls back to legacy global catch-up metadata only when no connected provider accounts are available', () => {
    expect(getSuuntoRouteCatchUpDateForConnectedProviders({
      didLastRouteImport: 1710000000000,
    }, [])?.getTime()).toBe(1710000000000);
  });

  it('builds shared snackbar messages for queued route catch-up results', () => {
    expect(buildSuuntoRouteCatchUpSnackbarMessage({
      queuedCount: 0,
      skippedCount: 0,
      failureCount: 0,
      totalCount: 0,
    })).toEqual({
      message: 'No Suunto routes were found to queue.',
      duration: 3500,
    });

    expect(buildSuuntoRouteCatchUpSnackbarMessage({
      queuedCount: 2,
      skippedCount: 1,
      failureCount: 3,
      totalCount: 6,
    })).toEqual({
      message: 'Queued 2 routes. Skipped 1. Failed 3.',
      duration: 4500,
    });

    expect(buildSuuntoRouteCatchUpSnackbarMessage({
      queuedCount: 0,
      skippedCount: 0,
      failureCount: 0,
      failedProviderCount: 1,
      totalCount: 0,
    })).toEqual({
      message: 'No Suunto routes were found to queue. Failed 1 connected account.',
      duration: 4500,
    });
  });

  it('builds source keys that change across connected and reconnect states', () => {
    expect(buildSuuntoRouteCatchUpPromptSource({
      connected: true,
      reconnectRequired: false,
      serviceTokens: [{ dateCreated: 1710000000000, userName: 'suunto-user' }],
    })).toBe('suunto-route-catch-up:connected:suunto-user:1710000000000');

    expect(buildSuuntoRouteCatchUpPromptSource({
      connected: false,
      reconnectRequired: true,
      reconnectPromptSource: 'suunto-reconnect-required:1710000000000',
    })).toBe('suunto-route-catch-up:suunto-reconnect-required:1710000000000');

    expect(buildSuuntoRouteCatchUpPromptSource({
      connected: false,
      reconnectRequired: false,
    })).toBeNull();
  });

  it('builds an order-independent source key for connected Suunto tokens', () => {
    const forward = buildSuuntoRouteCatchUpPromptSource({
      connected: true,
      reconnectRequired: false,
      serviceTokens: [
        { dateCreated: 1710000000000, userName: 'beta' },
        { dateCreated: 1700000000000, userName: 'alpha' },
      ],
    });
    const reversed = buildSuuntoRouteCatchUpPromptSource({
      connected: true,
      reconnectRequired: false,
      serviceTokens: [
        { dateCreated: 1700000000000, userName: 'alpha' },
        { dateCreated: 1710000000000, userName: 'beta' },
      ],
    });

    expect(forward).toBe('suunto-route-catch-up:connected:alpha:1700000000000|beta:1710000000000');
    expect(reversed).toBe(forward);
  });

  it('builds the dashboard-style route catch-up prompt variants', () => {
    expect(buildSuuntoRouteCatchUpPromptViewModel({
      variant: 'queue',
      busy: false,
      error: null,
    }).primaryAction?.id).toBe('queueSuuntoRouteCatchUp');

    expect(buildSuuntoRouteCatchUpPromptViewModel({
      variant: 'upgrade',
      busy: false,
      error: null,
    }).primaryAction?.id).toBe('upgradeToPro');

    expect(buildSuuntoRouteCatchUpPromptViewModel({
      variant: 'reconnect',
      busy: true,
      error: 'Reconnect required',
    })).toMatchObject({
      busy: true,
      error: 'Reconnect required',
      primaryAction: {
        id: 'reconnectSuuntoService',
      },
    });
  });
});
