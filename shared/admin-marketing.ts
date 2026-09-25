export type MarketingPlan = 'free' | 'basic' | 'pro';
export type MarketingCampaignStatus = 'draft' | 'preparing' | 'ready' | 'running' | 'paused' | 'completed';
export type MarketingRecipientStatus = 'pending' | 'queued' | 'accepted' | 'failed' | 'skipped';

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

export interface MarketingCampaignDraft {
  name: string;
  subject: string;
  content: MarketingDocument;
  cta: { label: string; url: string } | null;
  filters: MarketingAudienceFilters;
}

export interface MarketingCampaignStats {
  eligible: number;
  pending: number;
  queued: number;
  accepted: number;
  failed: number;
  skipped: number;
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
}

export interface MarketingCampaignListResponse {
  campaigns: MarketingCampaignView[];
  dailyCap: number;
  usedToday: number;
  utcDate: string;
}
