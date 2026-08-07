export const ASSISTANT_CONVERSATION_VERSION = 1 as const;
export const ASSISTANT_MAX_MESSAGE_CHARS = 1_000;
export const ASSISTANT_MAX_RESPONSE_CHARS = 4_000;
export const ASSISTANT_MAX_STORED_MESSAGES = 12;
export const ASSISTANT_MAX_EVIDENCE_ITEMS = 6;
export const ASSISTANT_MAX_VISUALS_PER_MESSAGE = 2;
export const ASSISTANT_MAX_CHART_SERIES = 4;
export const ASSISTANT_MAX_CHART_POINTS_PER_SERIES = 300;
export const ASSISTANT_MAX_MAP_MARKERS = 50;
export const ASSISTANT_MAX_MAP_PATH_POINTS = 500;
export const ASSISTANT_MAX_VISUAL_BYTES_PER_MESSAGE = 64 * 1024;
export const ASSISTANT_MAX_CONVERSATION_BYTES = 512 * 1024;
const ASSISTANT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,120}$/;

export const ASSISTANT_LOCATION_ACCESS_VALUES = [
  'coordinate_free',
  'precise_activity',
] as const;

export type AssistantLocationAccess = typeof ASSISTANT_LOCATION_ACCESS_VALUES[number];

export function isAssistantLocationAccess(
  value: unknown,
): value is AssistantLocationAccess {
  return typeof value === 'string'
    && ASSISTANT_LOCATION_ACCESS_VALUES.includes(value as AssistantLocationAccess);
}

export function isValidAssistantRequestId(value: unknown): value is string {
  return typeof value === 'string' && ASSISTANT_REQUEST_ID_PATTERN.test(value);
}

export type AssistantQuotaPeriodKind =
  | 'subscription'
  | 'grace_hold'
  | 'calendar_month'
  | 'no_billing_period';

export type AssistantQuotaResetMode =
  | 'date'
  | 'next_successful_payment';

export type AssistantQuotaBlockedReason =
  | 'requires_pro'
  | 'limit_reached'
  | null;

export interface AssistantQuotaStatus {
  role: 'free' | 'basic' | 'pro';
  limit: number;
  successfulRequestCount: number;
  activeRequestCount: number;
  remainingCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  periodKind: AssistantQuotaPeriodKind;
  resetMode: AssistantQuotaResetMode;
  isEligible: boolean;
  blockedReason: AssistantQuotaBlockedReason;
}

export type AssistantQuotaStatusRequest = Record<string, never>;

export type AssistantQuotaStatusResponse = AssistantQuotaStatus;

export interface AssistantEvidenceFact {
  label: string;
  value: string;
}

export interface AssistantEvidenceLink {
  label: string;
  url: string;
}

export interface AssistantEvidence {
  toolName: string;
  title: string;
  summary: string;
  facts: AssistantEvidenceFact[];
  links: AssistantEvidenceLink[];
}

export type AssistantChartType = 'line' | 'bar';
export type AssistantChartXAxisType = 'time' | 'linear' | 'category';

export interface AssistantChartPoint {
  x: string | number;
  y: number | null;
}

export interface AssistantChartSeries {
  label: string;
  unit: string | null;
  points: AssistantChartPoint[];
}

export interface AssistantChartVisual {
  kind: 'chart';
  title: string;
  chartType: AssistantChartType;
  xAxis: {
    type: AssistantChartXAxisType;
    label: string;
    unit: string | null;
    timeZone: string | null;
  };
  series: AssistantChartSeries[];
}

export type AssistantMapMarkerKind =
  | 'start'
  | 'end'
  | 'jump'
  | 'nearby'
  | 'search';

export interface AssistantMapPosition {
  latitudeDegrees: number;
  longitudeDegrees: number;
}

export interface AssistantMapMarker extends AssistantMapPosition {
  kind: AssistantMapMarkerKind;
  label: string;
}

export interface AssistantMapVisual {
  kind: 'map';
  title: string;
  style: 'user_preference' | 'satellite';
  markers: AssistantMapMarker[];
  path: AssistantMapPosition[];
}

export type AssistantVisual = AssistantChartVisual | AssistantMapVisual;

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  evidence?: AssistantEvidence[];
  visuals?: AssistantVisual[];
}

export interface AssistantConversation {
  version: typeof ASSISTANT_CONVERSATION_VERSION;
  conversationId: string;
  messages: AssistantMessage[];
  expiresAt: string;
}

export interface AssistantChatRequest {
  requestId: string;
  message: string;
  timeZone: string;
  locationAccess: AssistantLocationAccess;
  conversationId?: string;
}

export interface AssistantChatResponse {
  conversation: AssistantConversation;
  quota: AssistantQuotaStatus;
  pendingRequestId: string | null;
}

export type GetAssistantConversationRequest = Record<string, never>;

export interface GetAssistantConversationResponse {
  conversation: AssistantConversation | null;
  pendingRequestId: string | null;
  locationAccess: AssistantLocationAccess;
}

export interface ResetAssistantConversationRequest {
  locationAccess: AssistantLocationAccess;
}

export interface ResetAssistantConversationResponse {
  conversation: AssistantConversation;
}
