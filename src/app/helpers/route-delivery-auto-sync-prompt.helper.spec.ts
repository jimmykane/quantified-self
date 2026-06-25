import { describe, expect, it } from 'vitest';

import { DASHBOARD_ACTION_PROMPT_ROUTE_DELIVERY_AUTO_SYNC_ID } from './dashboard-action-prompt.helper';
import { buildRouteDeliveryAutoSyncPromptViewModel } from './route-delivery-auto-sync-prompt.helper';

describe('route-delivery-auto-sync-prompt helper', () => {
  it('builds the shared action card prompt view model', () => {
    const prompt = buildRouteDeliveryAutoSyncPromptViewModel({
      busy: false,
      error: null,
    });

    expect(prompt).toMatchObject({
      id: DASHBOARD_ACTION_PROMPT_ROUTE_DELIVERY_AUTO_SYNC_ID,
      title: 'Sync Suunto routes to Garmin courses',
      description: 'Automatically deliver new and updated Suunto routes saved in Quantified Self to Garmin as courses.',
      primaryAction: {
        id: 'enableRouteDeliveryAutoSync',
        label: 'Enable route sync',
      },
      secondaryAction: {
        id: 'dismissRouteDeliveryAutoSync',
        label: 'Not now',
      },
    });
  });

  it('carries loading and error state for the shared prompt component', () => {
    expect(buildRouteDeliveryAutoSyncPromptViewModel({
      busy: true,
      error: 'Could not enable route sync.',
    })).toMatchObject({
      busy: true,
      error: 'Could not enable route sync.',
      primaryAction: {
        loadingLabel: 'Enabling...',
      },
    });
  });
});
