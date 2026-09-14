import { buildGarminPermissionAccounts, GARMIN_PERMISSION_DETAILS } from './garmin-permissions.helper';

describe('Garmin permission display', () => {
  it('covers every supported Garmin permission without claiming feature readiness', () => {
    expect(GARMIN_PERMISSION_DETAILS.map(permission => permission.id)).toEqual([
      'HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT', 'WORKOUT_IMPORT',
      'HEALTH_EXPORT', 'COURSE_IMPORT',
    ]);
    expect(GARMIN_PERMISSION_DETAILS.find(permission => permission.id === 'WORKOUT_IMPORT')?.label).toBe('Training');
    expect(GARMIN_PERMISSION_DETAILS.find(permission => permission.id === 'WORKOUT_IMPORT')?.description).toContain('when available for your account');
    expect(GARMIN_PERMISSION_DETAILS.find(permission => permission.id === 'WORKOUT_IMPORT')?.description).toContain('Requires explicit opt-in');
  });

  it.each([
    { permissions: undefined }, { permissions: [] },
    { permissions: ['MCT_EXPORT'] }, { permissions: [' MCT_EXPORT ', 'MCT_EXPORT'] },
  ])(
    'omits the deferred MCT permission regardless of the reported grant: $permissions', ({ permissions }) => {
      const input = [{ providerUserId: 'account', ...(permissions ? { permissions } : {}) }];
      const before = structuredClone(input);
      const [account] = buildGarminPermissionAccounts(input);
      expect(account.permissionsKnown).toBe(permissions !== undefined);
      expect(account.permissions.map(row => row.id)).toEqual(GARMIN_PERMISSION_DETAILS.map(permission => permission.id));
      expect(input).toEqual(before);
    },
  );

  it('shows granted and not-granted permissions separately for each account', () => {
    const accounts = buildGarminPermissionAccounts([
      { providerUserId: 'account-a', permissions: ['ACTIVITY_EXPORT', 'WORKOUT_IMPORT'] },
      { providerUserId: 'account-b', permissions: ['COURSE_IMPORT'] },
    ]);
    expect(accounts).toHaveLength(2);
    expect(accounts[0].permissions.find(row => row.id === 'WORKOUT_IMPORT')?.status).toBe('Granted');
    expect(accounts[0].permissions.find(row => row.id === 'COURSE_IMPORT')?.status).toBe('Not granted');
    expect(accounts[1].permissions.find(row => row.id === 'WORKOUT_IMPORT')?.status).toBe('Not granted');
    expect(accounts[1].permissions.find(row => row.id === 'COURSE_IMPORT')?.status).toBe('Granted');
  });

  it('distinguishes an explicit empty grant from an unreported legacy snapshot', () => {
    const [empty, unknown] = buildGarminPermissionAccounts([
      { providerUserId: 'no-grants', permissions: [] }, { providerUserId: 'unknown' },
    ]);
    expect(empty.permissionsKnown).toBe(true);
    expect(empty.permissions.every(row => row.status === 'Not granted')).toBe(true);
    expect(unknown.permissionsKnown).toBe(false);
    expect(unknown.permissions.every(row => row.status === 'Not reported')).toBe(true);
  });

  it('preserves additional provider permissions, normalizes duplicates, and does not mutate the source', () => {
    const input = [{ providerUserId: 'account', permissions: [' WORKOUT_IMPORT ', 'WORKOUT_IMPORT', 'MCT_EXPORT', 'FUTURE_SCOPE'] }];
    const before = structuredClone(input);
    const [account] = buildGarminPermissionAccounts(input);
    expect(account.permissions.filter(row => row.status === 'Granted').map(row => row.id)).toEqual(['WORKOUT_IMPORT', 'FUTURE_SCOPE']);
    expect(account.permissions.find(row => row.id === 'FUTURE_SCOPE')?.label).toBe('FUTURE_SCOPE');
    expect(input).toEqual(before);
  });

  it('does not fabricate a grant when permission entries are malformed', () => {
    const [account] = buildGarminPermissionAccounts([{ providerUserId: 'account', permissions: ['WORKOUT_IMPORT', ''] }]);
    expect(account.permissionsKnown).toBe(false);
    expect(account.permissions.every(row => row.status === 'Not reported')).toBe(true);
  });

  it('handles absent snapshots and ignores entries without account identity', () => {
    expect(buildGarminPermissionAccounts(undefined)).toEqual([]);
    expect(buildGarminPermissionAccounts([{ permissions: ['WORKOUT_IMPORT'] }])).toEqual([]);
  });
});
