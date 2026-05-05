import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  buildDashboardActionPromptViewModels,
  DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID,
  DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_SOURCE,
  DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID,
  DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_SOURCE,
  DASHBOARD_ACTION_PROMPT_UNIT_SETUP_ID,
  isDashboardActionPromptDismissed,
  markDashboardActionPromptDismissed,
  normalizeDashboardActionPrompts,
} from './dashboard-action-prompt.helper';
import { AppAppSettingsInterface } from '../models/app-user.interface';

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
    });

    expect(prompts.map(prompt => prompt.id)).toEqual([
      DASHBOARD_ACTION_PROMPT_UNIT_SETUP_ID,
      DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID,
      DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID,
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
});
