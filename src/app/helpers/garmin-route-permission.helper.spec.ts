import { describe, expect, it } from 'vitest';

import { DASHBOARD_ACTION_PROMPT_GARMIN_ROUTE_PERMISSION_ID } from './dashboard-action-prompt.helper';
import {
  buildGarminRoutePermissionPromptSource,
  buildGarminRoutePermissionPromptViewModel,
} from './garmin-route-permission.helper';

describe('garmin-route-permission helper', () => {
  it('builds a source when Course Import is missing from a loaded Garmin token', () => {
    const source = buildGarminRoutePermissionPromptSource({
      connected: true,
      reconnectRequired: false,
      tokenLike: {
        userID: 'garmin-user-1',
        permissions: ['ACTIVITY_EXPORT'],
        permissionsLastChangedAt: 1710000000,
        dateCreated: 1700000000000,
      },
      missingPermissions: ['COURSE_IMPORT'],
    });

    expect(source).toBe('garmin-route-course-import:garmin-user-1:1710000000:COURSE_IMPORT');
  });

  it('builds a source for legacy Garmin tokens without stored permissions', () => {
    const source = buildGarminRoutePermissionPromptSource({
      connected: true,
      reconnectRequired: false,
      tokenLike: {
        userID: 'garmin-user-1',
        dateCreated: 1700000000000,
      },
      missingPermissions: ['COURSE_IMPORT'],
    });

    expect(source).toBe('garmin-route-course-import:garmin-user-1:1700000000000:COURSE_IMPORT');
  });

  it('returns null when Course Import is not missing', () => {
    const source = buildGarminRoutePermissionPromptSource({
      connected: true,
      reconnectRequired: false,
      tokenLike: {
        userID: 'garmin-user-1',
        permissions: ['COURSE_IMPORT'],
        dateCreated: 1700000000000,
      },
      missingPermissions: [],
    });

    expect(source).toBeNull();
  });

  it('builds the shared action card prompt view model', () => {
    const prompt = buildGarminRoutePermissionPromptViewModel({
      busy: false,
      error: null,
    });

    expect(prompt).toMatchObject({
      id: DASHBOARD_ACTION_PROMPT_GARMIN_ROUTE_PERMISSION_ID,
      title: 'Allow saved routes to be sent to Garmin',
      description: expect.stringContaining('In Garmin Connect, open Connected Apps'),
      primaryAction: {
        id: 'reconnectGarminRoutePermission',
        label: 'Reconnect Garmin',
      },
      secondaryAction: {
        id: 'dismissGarminRoutePermission',
      },
    });
    expect(prompt.description).not.toContain('garmin-user-1');
  });
});
