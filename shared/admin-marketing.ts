export type MarketingPlan = 'free' | 'basic' | 'pro';
export type MarketingCampaignStatus = 'draft' | 'deleting' | 'preparing' | 'ready' | 'running' | 'paused' | 'completed';
export type MarketingRecipientStatus = 'pending' | 'queued' | 'accepted' | 'failed' | 'skipped';

export const DEFAULT_MARKETING_SENDER_NAME = 'Dimitrios from Quantified Self';
export const MARKETING_SENDER_NAME_MAX_LENGTH = 120;
export const MARKETING_SENDER_EMAIL = 'updates@quantified-self.io';

/** Shared by the form and server; inspect controls before trimming. */
export function marketingSenderNameError(value: unknown): string {
  if (typeof value !== 'string') return 'Sender name must be text.';
  if (Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029;
  })) return 'Sender name cannot contain line breaks or control characters.';
  const name = value.trim();
  if (!name) return 'Enter a sender name.';
  return name.length > MARKETING_SENDER_NAME_MAX_LENGTH
    ? `Use ${MARKETING_SENDER_NAME_MAX_LENGTH} characters or fewer for the sender name.` : '';
}

export interface MarketingTextMark {
  type: 'bold' | 'italic' | 'link';
  attrs?: { href?: string };
}

export interface MarketingTextNode {
  type: 'text';
  text: string;
  marks?: MarketingTextMark[];
}

export interface MarketingContentNode {
  type: 'paragraph' | 'heading' | 'bulletList' | 'orderedList' | 'listItem' | 'hardBreak' | 'text';
  attrs?: { level?: number; href?: string };
  content?: Array<MarketingContentNode | MarketingTextNode>;
  text?: string;
  marks?: MarketingTextMark[];
}

export interface MarketingDocument {
  type: 'doc';
  content: MarketingContentNode[];
}

export interface MarketingAudienceFilters {
  plans: MarketingPlan[];
  signupFrom: string | null;
  signupTo: string | null;
}

export interface MarketingDailySchedule {
  time: string;
  timeZone: string;
}

export interface MarketingCampaignDraft {
  name: string;
  subject: string;
  /** Missing on legacy campaigns/clients; the server applies the default name. */
  senderName?: string;
  content: MarketingDocument;
  cta: { label: string; url: string } | null;
  filters: MarketingAudienceFilters;
  /** Missing/null keeps existing campaigns on immediate sending. */
  schedule?: MarketingDailySchedule | null;
}

export interface MarketingCampaignPreview {
  subject: string;
  from: string;
  replyTo: string;
  html: string;
  text: string;
}

export interface MarketingCampaignStats {
  eligible: number;
  pending: number;
  queued: number;
  accepted: number;
  failed: number;
  skipped: number;
}

/** Prepared audiences can be discarded until Start, including scheduled campaigns. */
export function canDeleteMarketingCampaign(campaign: {
  status: unknown;
  startedAt?: unknown;
  stats?: Partial<MarketingCampaignStats> | null;
} | null | undefined): boolean {
  if (!campaign) return false;
  if (campaign.status === 'draft' || campaign.status === 'deleting') return true;
  return campaign.status === 'ready' && campaign.startedAt == null &&
    campaign.stats?.queued === 0 && campaign.stats.accepted === 0 &&
    campaign.stats.failed === 0 && campaign.stats.skipped === 0;
}

export interface MarketingAudienceExclusions {
  noAuth: number;
  disabledOrAdmin: number;
  noEmail: number;
  noProfile: number;
  deletionMarked: number;
  plan: number;
  signupDate: number;
}

export interface MarketingCampaignView extends MarketingCampaignDraft {
  id: string;
  status: MarketingCampaignStatus;
  stats: MarketingCampaignStats;
  exclusions: MarketingAudienceExclusions;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  lastTestMailId: string | null;
  lastTestState: string | null;
  lastTestTo: string | null;
  nextScheduledSendAt?: string | null;
}

export interface MarketingCampaignListResponse {
  campaigns: MarketingCampaignView[];
  dailyCap: number;
  usedToday: number;
  utcDate: string;
}
