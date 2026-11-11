import type { PublicFeaturePreviewKey } from '../components/public-seo/public-feature-preview.types';

export type DeferredLoadArea = PublicFeaturePreviewKey | 'navigation' | 'training-settings' | 'power-settings'
  | 'notification-settings' | 'dashboard-map';

const labels: Record<DeferredLoadArea, string> = {
  navigation: 'Navigation', 'training-settings': 'Training settings', 'power-settings': 'Workout power settings',
  'notification-settings': 'Notification settings', 'dashboard-map': 'Map',
  'health-overview': 'Preview', 'health-sleep': 'Preview', 'health-hrv': 'Preview', 'health-note-comparison': 'Preview',
  'health-weight': 'Preview', 'training-snapshot': 'Preview', 'training-signals': 'Preview', 'training-hero': 'Preview',
  'training-readiness': 'Preview', 'training-explorer': 'Preview', 'training-plans': 'Preview', 'daily-workout': 'Preview',
  dashboard: 'Preview', 'workout-analysis': 'Preview', 'activity-map': 'Preview', 'reviewer-benchmark': 'Preview',
  'assistant-example': 'Preview', 'mcp-flow': 'Preview', 'provider-flow': 'Preview',
};

export function isDeferredLoadArea(value: unknown): value is DeferredLoadArea {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(labels, value);
}

export function deferredLoadLabel(area: unknown): string {
  return isDeferredLoadArea(area) ? labels[area] : 'Content';
}
