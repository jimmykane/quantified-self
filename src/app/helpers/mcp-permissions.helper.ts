export type McpScope =
  | 'timeline-notes:read'
  | 'health:read'
  | 'metrics:read'
  | 'measurements:read'
  | 'sleep:read'
  | 'activity-details:read'
  | 'activity-descriptions:read'
  | 'activity-location:read'
  | 'routes:read'
  | 'route-location:read';

export const MCP_SCOPE_PARENTS: Partial<Record<McpScope, McpScope>> = {
  'activity-location:read': 'activity-details:read',
  'activity-descriptions:read': 'activity-details:read',
  'route-location:read': 'routes:read',
};

export const MCP_SCOPE_CONTENT: Record<McpScope, {
  title: string;
  description: string;
}> = {
  'activity-descriptions:read': {
    title: 'Activity descriptions',
    description: 'Read the full private event description shown in the QS.io event editor for a selected activity. Activities within the same event share this text. Requires Individual activity details. Selected by default when requested; uncheck it before approving to keep descriptions private from this client. Existing connections must reauthorize. Text may include sensitive health, personal or location information, even without Activity locations permission. Revoking access cannot erase copies already received. No descriptions can be changed.',
  },
  'timeline-notes:read': {
    title: 'Timeline notes',
    description: 'Read full private note titles and details, categories, dates and captured time zones, including notes hidden from charts. This text may contain sensitive health or personal information. Selected by default when requested; uncheck it before approving to keep notes private from this client. Existing connections must reauthorize. Revoking access cannot erase copies already received by the client. No notes or Training plans can be changed.',
  },
  'health:read': {
    title: 'Health metrics',
    description: 'Read recorded all-day heart rate, HRV, stress, resources, movement, energy, blood pressure and other Health metrics. Includes provider names, local account numbers, calendar dates and bounded sample trends with exact UTC times. Garmin Body Battery keeps its labelled Garmin points scale. Body composition also needs Body measurements permission and excludes source identity and exact times. Raw provider payloads, device details, account IDs and Sleep sessions are excluded. No measurements can be added, edited or deleted.',
  },
  'metrics:read': {
    title: 'Activity and Training metrics',
    description: 'Read persisted numeric activity metrics and redacted Training-derived snapshots. When individual activity access is also granted, the client can request selected canonical numeric metrics for one activity.',
  },
  'measurements:read': {
    title: 'Body measurements',
    description: 'Read bounded identity-free body-measurement history such as weight. Values are grouped by day, week, or month; exact source timestamps, event or activity identity, provider, device, and source details are excluded.',
  },
  'sleep:read': {
    title: 'Sleep summaries',
    description: 'Read redacted sleep sessions and aggregated summaries, including bounded discovery of available aggregate HRV, heart-rate, blood-oxygen, and respiration values. Raw sensor samples and provider payloads are excluded.',
  },
  'activity-details:read': {
    title: 'Individual activity details',
    description: 'Read non-location activity summaries, laps, swim lengths, MTB jump measurements, selected activity metrics, bounded on-demand chart series, and paginated detailed samples for selected metrics from existing original files. Detailed samples include every available elapsed-second value with missing readings marked. Exact locations and breadcrumb traces require the separate activity-location permission.',
  },
  'activity-location:read': {
    title: 'Activity locations',
    description: 'Read exact activity start, end, MTB jump, and bounded breadcrumb coordinates, and search activity starts or ends near a place. Place-name searches send the location text to Mapbox.',
  },
  'routes:read': {
    title: 'Saved-route summaries',
    description: 'Read route names, activity types, metric summaries, route, waypoint, and point counts, import/update times, and signed-in application links. Exact route locations require the separate saved-route location permission.',
  },
  'route-location:read': {
    title: 'Saved-route locations and geometry',
    description: 'Read exact route bounds, preview geometry and segment endpoints, waypoint coordinates, altitude and distance, and search routes near a place. Place-name searches send the location text to Mapbox.',
  },
};
