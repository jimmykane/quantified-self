import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  buildActivityAutoSyncEnabledSnackbarMessage,
  buildReconnectSuuntoServicePromptSource,
  buildDashboardActionPromptViewModels,
  DASHBOARD_ACTION_PROMPT_ACTIVITY_AUTO_SYNC_SOURCE,
  DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID,
  DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_SOURCE,
  DASHBOARD_ACTION_PROMPT_ENABLE_ACTIVITY_AUTO_SYNC_ID,
  DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID,
  DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_SOURCE,
  DASHBOARD_ACTION_PROMPT_UNIT_SETUP_ID,
  isDashboardActionPromptDismissed,
  markDashboardActionPromptDismissed,
  normalizeDashboardActionPrompts,
  resolveDashboardActivityAutoSyncRouteIds,
} from './dashboard-action-prompt.helper';
import { AppAppSettingsInterface } from '../models/app-user.interface';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';

describe('dashboard-action-prompt.helper', () => {
  it('normalizes dismissed prompt states and drops invalid states', () => {
    expect(normalizeDashboardActionPrompts({
      unitSetup: {
        state: 'dismissed',
        dismissedAt: 123,
        source: 'unit-setup',
      },
      connectActivityService: {
        state: 'active',
      },
      futurePrompt: {
        state: 'dismissed',
        dismissedAt: -1,
        source: '  future-source  ',
      },
    })).toEqual({
      unitSetup: {
        state: 'dismissed',
        dismissedAt: 123,
        source: 'unit-setup',
      },
      futurePrompt: {
        state: 'dismissed',
        source: 'future-source',
      },
    });
  });

  it('marks a prompt dismissed without mutating the previous prompt map', () => {
    const previousPromptMap = {
      unitSetup: {
        state: 'dismissed' as const,
        dismissedAt: 10,
        source: 'unit-setup',
      },
    };
    const appSettings = {
      dashboardActionPrompts: previousPromptMap,
    } as AppAppSettingsInterface;

    const dismissedState = markDashboardActionPromptDismissed(
      appSettings,
      DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID,
      DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_SOURCE,
      20,
    );

    expect(dismissedState).toEqual({
      state: 'dismissed',
      dismissedAt: 20,
      source: DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_SOURCE,
    });
    expect(previousPromptMap).toEqual({
      unitSetup: {
        state: 'dismissed',
        dismissedAt: 10,
        source: 'unit-setup',
      },
    });
    expect(appSettings.dashboardActionPrompts).toEqual({
      ...previousPromptMap,
      connectActivityService: dismissedState,
    });
  });

  it('checks dismissal state by prompt id', () => {
    expect(isDashboardActionPromptDismissed({
      dashboardActionPrompts: {
        connectActivityService: {
          state: 'dismissed',
        },
      },
    } as AppAppSettingsInterface, DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID)).toBe(true);
    expect(isDashboardActionPromptDismissed(null, DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID)).toBe(false);
  });

  it('checks dismissal state by prompt id and source when provided', () => {
    const sourceA = buildReconnectSuuntoServicePromptSource(100);
    const sourceB = buildReconnectSuuntoServicePromptSource(200);

    expect(isDashboardActionPromptDismissed({
      dashboardActionPrompts: {
        reconnectSuuntoService: {
          state: 'dismissed',
          source: sourceA,
        },
      },
    } as AppAppSettingsInterface, 'reconnectSuuntoService', sourceA)).toBe(true);
    expect(isDashboardActionPromptDismissed({
      dashboardActionPrompts: {
        reconnectSuuntoService: {
          state: 'dismissed',
          source: sourceA,
        },
      },
    } as AppAppSettingsInterface, 'reconnectSuuntoService', sourceB)).toBe(false);
  });

  it('builds the standard unit and service prompt view models', () => {
    const prompts = buildDashboardActionPromptViewModels({
      showUnitSetupPrompt: true,
      unitSetupBusy: false,
      unitSetupError: null,
      showFirstActivityUploadPrompt: true,
      firstActivityUploadBusy: false,
      firstActivityUploadError: null,
      showConnectActivityServicePrompt: true,
      connectActivityServiceBusy: true,
      connectActivityServiceError: 'Could not save.',
      showEnableActivityAutoSyncPrompt: true,
      enableActivityAutoSyncBusy: false,
      enableActivityAutoSyncError: null,
      enableActivityAutoSyncRouteIds: [
        ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
        ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
      ],
      showReconnectSuuntoServicePrompt: false,
      reconnectSuuntoServiceBusy: false,
      reconnectSuuntoServiceError: null,
    });

    expect(prompts.map(prompt => prompt.id)).toEqual([
      DASHBOARD_ACTION_PROMPT_UNIT_SETUP_ID,
      DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID,
      DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID,
      DASHBOARD_ACTION_PROMPT_ENABLE_ACTIVITY_AUTO_SYNC_ID,
    ]);
    expect(prompts[0].primaryAction?.id).toBe('applyUnitSetup');
    expect(prompts[0].menuActions?.[0]?.id).toBe('openUnitSettings');
    expect(prompts[1]).toMatchObject({
      id: DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID,
      title: 'Upload your first activities',
      description: 'Start with FIT, GPX, TCX, JSON, or SML files. Upgrade to Pro when you want automatic imports from Garmin, Suunto, or COROS.',
      primaryAction: {
        id: 'upgradeToPro',
      },
      secondaryAction: {
        id: 'dismissFirstActivityUpload',
      },
    });
    expect(prompts[2]).toMatchObject({
      busy: true,
      error: 'Could not save.',
      primaryAction: {
        id: 'connectActivityService',
        menuTrigger: true,
      },
    });
    expect(prompts[2].menuActions?.map(action => action.value)).toEqual([
      ServiceNames.GarminAPI,
      ServiceNames.SuuntoApp,
      ServiceNames.COROSAPI,
    ]);
    expect(prompts[2].menuActions?.map(action => action.serviceName)).toEqual([
      ServiceNames.GarminAPI,
      ServiceNames.SuuntoApp,
      ServiceNames.COROSAPI,
    ]);
    expect(prompts[3]).toMatchObject({
      id: DASHBOARD_ACTION_PROMPT_ENABLE_ACTIVITY_AUTO_SYNC_ID,
      title: 'Send new activities to Suunto',
      description: 'Enable Garmin and COROS -> Suunto auto-sync for new imported activities. Existing activities can be queued from Services with Manual Catch-up.',
      primaryAction: {
        id: 'enableActivityAutoSync',
        label: 'Enable auto-sync',
      },
      secondaryAction: {
        id: 'dismissEnableActivityAutoSync',
        label: 'Not now',
      },
    });
  });

  it('builds the Suunto reconnect prompt view model', () => {
    const prompts = buildDashboardActionPromptViewModels({
      showUnitSetupPrompt: false,
      unitSetupBusy: false,
      unitSetupError: null,
      showFirstActivityUploadPrompt: false,
      firstActivityUploadBusy: false,
      firstActivityUploadError: null,
      showConnectActivityServicePrompt: false,
      connectActivityServiceBusy: false,
      connectActivityServiceError: null,
      showEnableActivityAutoSyncPrompt: false,
      enableActivityAutoSyncBusy: false,
      enableActivityAutoSyncError: null,
      enableActivityAutoSyncRouteIds: [],
      showReconnectSuuntoServicePrompt: true,
      reconnectSuuntoServiceBusy: true,
      reconnectSuuntoServiceError: 'Reconnect failed.',
    });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      id: 'reconnectSuuntoService',
      title: 'Reconnect Suunto',
      description: 'Suunto stopped accepting the previous connection. Reconnect to resume sleep sync, history imports, and uploads. Garmin/COROS -> Suunto auto-sync routes stay off until you enable them again.',
      busy: true,
      error: 'Reconnect failed.',
      primaryAction: {
        id: 'reconnectSuuntoService',
      },
      secondaryAction: {
        id: 'dismissReconnectSuuntoService',
      },
    });
  });

  it('marks the first activity prompt dismissed with its own source', () => {
    const appSettings = {} as AppAppSettingsInterface;

    const dismissedState = markDashboardActionPromptDismissed(
      appSettings,
      DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID,
      DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_SOURCE,
      30,
    );

    expect(dismissedState).toEqual({
      state: 'dismissed',
      dismissedAt: 30,
      source: DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_SOURCE,
    });
    expect(isDashboardActionPromptDismissed(
      appSettings,
      DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID,
    )).toBe(true);
  });

  it('marks the activity auto-sync prompt dismissed with its own source', () => {
    const appSettings = {} as AppAppSettingsInterface;

    const dismissedState = markDashboardActionPromptDismissed(
      appSettings,
      DASHBOARD_ACTION_PROMPT_ENABLE_ACTIVITY_AUTO_SYNC_ID,
      DASHBOARD_ACTION_PROMPT_ACTIVITY_AUTO_SYNC_SOURCE,
      40,
    );

    expect(dismissedState).toEqual({
      state: 'dismissed',
      dismissedAt: 40,
      source: DASHBOARD_ACTION_PROMPT_ACTIVITY_AUTO_SYNC_SOURCE,
    });
    expect(isDashboardActionPromptDismissed(
      appSettings,
      DASHBOARD_ACTION_PROMPT_ENABLE_ACTIVITY_AUTO_SYNC_ID,
    )).toBe(true);
  });

  it('resolves eligible disabled dashboard activity auto-sync routes', () => {
    const routeSettings = {
      [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: false },
      [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: { enabled: false },
    };
    const userID = 'user-1';

    expect(resolveDashboardActivityAutoSyncRouteIds({
      userID,
      routeSettings,
      connectionState: {
        [ServiceNames.GarminAPI]: true,
        [ServiceNames.SuuntoApp]: true,
        [ServiceNames.COROSAPI]: true,
      },
    })).toEqual([
      ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
    ]);

    expect(resolveDashboardActivityAutoSyncRouteIds({
      userID,
      routeSettings: {
        ...routeSettings,
        [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
      },
      connectionState: {
        [ServiceNames.GarminAPI]: true,
        [ServiceNames.SuuntoApp]: true,
        [ServiceNames.COROSAPI]: true,
      },
    })).toEqual([
      ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
    ]);

    expect(resolveDashboardActivityAutoSyncRouteIds({
      userID,
      routeSettings,
      connectionState: {
        [ServiceNames.GarminAPI]: true,
        [ServiceNames.SuuntoApp]: false,
        [ServiceNames.COROSAPI]: true,
      },
    })).toEqual([]);

    expect(resolveDashboardActivityAutoSyncRouteIds({
      userID,
      routeSettings,
      connectionState: {
        [ServiceNames.GarminAPI]: false,
        [ServiceNames.SuuntoApp]: true,
        [ServiceNames.COROSAPI]: false,
      },
    })).toEqual([]);

    expect(resolveDashboardActivityAutoSyncRouteIds({
      userID,
      routeSettings,
      reconnectRequiredServices: {
        [ServiceNames.SuuntoApp]: true,
      },
      connectionState: {
        [ServiceNames.GarminAPI]: true,
        [ServiceNames.SuuntoApp]: true,
        [ServiceNames.COROSAPI]: true,
      },
    })).toEqual([]);
  });

  it('formats grouped activity auto-sync success copy', () => {
    expect(buildActivityAutoSyncEnabledSnackbarMessage([
      ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
    ])).toBe('Auto-sync enabled for Garmin and COROS -> Suunto.');
  });
});
