import {
  DASHBOARD_ACTION_PROMPT_ROUTE_DELIVERY_AUTO_SYNC_ID,
  DashboardActionPromptViewModel,
} from './dashboard-action-prompt.helper';

export interface BuildRouteDeliveryAutoSyncPromptViewModelOptions {
  busy: boolean;
  error: string | null;
}

export function buildRouteDeliveryAutoSyncPromptViewModel(
  options: BuildRouteDeliveryAutoSyncPromptViewModelOptions,
): DashboardActionPromptViewModel {
  return {
    id: DASHBOARD_ACTION_PROMPT_ROUTE_DELIVERY_AUTO_SYNC_ID,
    icon: 'sync_alt',
    title: 'Sync Suunto routes to Garmin courses',
    description: 'Automatically deliver new and updated Suunto routes saved in Quantified Self to Garmin as courses.',
    busy: options.busy,
    error: options.error,
    primaryAction: {
      id: 'enableRouteDeliveryAutoSync',
      label: 'Enable route sync',
      icon: 'sync',
      loadingLabel: 'Enabling...',
    },
    secondaryAction: {
      id: 'dismissRouteDeliveryAutoSync',
      label: 'Not now',
    },
  };
}
