export type McpScope =
  | 'training-plans:read'
  | 'training-plans:write'
  | 'training-delivery:write'
  | 'timeline-notes:read'
  | 'timeline-notes:write'
  | 'health:read'
  | 'metrics:read'
  | 'measurements:read'
  | 'sleep:read'
  | 'activity-details:read'
  | 'events:write'
  | 'activity-descriptions:read'
  | 'activity-location:read'
  | 'routes:read'
  | 'route-location:read';

export const MCP_SCOPE_PARENTS: Partial<Record<McpScope, McpScope>> = {
  'training-plans:write': 'training-plans:read',
  'training-delivery:write': 'training-plans:read',
  'timeline-notes:write': 'timeline-notes:read',
  'activity-location:read': 'activity-details:read',
  'activity-descriptions:read': 'activity-details:read',
  'events:write': 'activity-details:read',
  'route-location:read': 'routes:read',
};

export const MCP_SCOPE_CONTENT: Record<McpScope, {
  title: string;
  description: string;
}> = {
  'training-plans:read': {
    title: 'Training plans and planned workouts',
    description: 'Read your current plans and standalone planned workouts, including names, dates, complete workout instructions, step notes, exact recorded completion links and existing service sync summaries. Authored text may contain sensitive health or personal information. Existing connections must reauthorize. This does not grant activity or Timeline notes access. Revoking access cannot erase copies already received.',
  },
  'training-plans:write': {
    title: 'Change Training plans and workouts',
    description: 'Create and edit plans and planned workouts, move or copy workouts, change plan dates and lifecycle, mark workouts skipped, move workouts to recoverable history, and explicitly delete a plan. Plan deletion is reviewed alone and requires choosing whether its workouts become standalone or are permanently deleted; the plan and its history are permanently removed. Every proposal is previewed before a separate apply tool governed by your client\'s approval controls. Permanent single-workout deletion and history restore are not allowed.',
  },
  'training-delivery:write': {
    title: 'Change planned-workout sync',
    description: 'Enable or stop plan sync and send, resume, retry, check or approve planned-workout delivery for one or all connected services. Every proposal is previewed before a separate apply tool governed by your client\'s approval controls. Provider delivery remains subject to Pro access, connection permissions and rollout availability. This cannot connect or disconnect a service.',
  },
  'activity-descriptions:read': {
    title: 'Activity descriptions',
    description: 'Read the full private event description shown in the QS.io event editor for a selected activity. Activities within the same event share this text. Requires Individual activity details. Selected by default when requested; uncheck it before approving to keep descriptions private from this client. Existing connections must reauthorize. Text may include sensitive health, personal or location information, even without Activity locations permission. Revoking access cannot erase copies already received. No descriptions can be changed.',
  },
  'timeline-notes:read': {
    title: 'Timeline notes',
    description: 'Read full private note titles and details, categories, dates and captured time zones, including notes hidden from charts. This text may contain sensitive health or personal information. Selected by default when requested; uncheck it before approving to keep notes private from this client. Existing connections must reauthorize. Revoking access cannot erase copies already received by the client. Changing notes requires the separate Timeline notes changes permission.',
  },
  'timeline-notes:write': {
    title: 'Change Timeline notes',
    description: 'Create, edit, and permanently delete your Timeline notes. Selected by default when requested; uncheck it before approving to keep this client read-only. Changes use the client\'s native tool-approval controls, require the latest note revision for edits or deletion, and never change Health metrics, readiness, or Training plans. Deleted note text cannot be restored; Quantified Self retains only a content-free deletion receipt. Requires Timeline notes access.',
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
    description: 'Read non-location activity summaries and their event tags, filter workouts by exact case-insensitive tags, and read laps, swim lengths, MTB jump measurements, selected activity metrics, bounded on-demand chart series, and paginated detailed samples for selected metrics from existing original files. Activities from the same event share tags. Tags can contain personal, health, or location context and are treated as untrusted labels. Detailed samples include every available elapsed-second value with missing readings marked. Exact locations and breadcrumb traces require the separate activity-location permission.',
  },
  'events:write': {
    title: 'Change events',
    description: 'Change event-owned details through focused tools. Currently this permission only replaces tags on a selected activity\'s parent event after reading its current tags. Selected by default when requested; uncheck it before approving to keep events read-only. Sibling activities share the change, concurrent edits fail, and benchmark events are excluded. This cannot currently edit titles, descriptions, activity data, metrics, or provider records. Requires Individual activity details.',
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
