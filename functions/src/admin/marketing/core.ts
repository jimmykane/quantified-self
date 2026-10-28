import type { MarketingAudienceFilters, MarketingCampaignStats, MarketingPlan, MarketingRecipientStatus } from '../../../../shared/admin-marketing';

export const DEFAULT_MARKETING_DAILY_CAP = 10;
export const MAX_MARKETING_DAILY_CAP = 1000;

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function validDailyCap(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_MARKETING_DAILY_CAP) {
    throw new Error(`Daily limit must be between 1 and ${MAX_MARKETING_DAILY_CAP}.`);
  }
  return value as number;
}

export function signupInRange(creationTime: string, filters: MarketingAudienceFilters): boolean {
  const date = new Date(creationTime);
  if (!Number.isFinite(date.getTime())) return false;
  const day = utcDay(date);
  return (!filters.signupFrom || day >= filters.signupFrom) && (!filters.signupTo || day <= filters.signupTo);
}

export function selectedPlan(plan: MarketingPlan, filters: MarketingAudienceFilters): boolean {
  return filters.plans.includes(plan);
}

export function blankStats(eligible = 0): MarketingCampaignStats {
  return { eligible, pending: eligible, queued: 0, accepted: 0, failed: 0, skipped: 0 };
}

export function transitionStats(stats: MarketingCampaignStats, from: MarketingRecipientStatus, to: MarketingRecipientStatus): MarketingCampaignStats {
  if (from === to) return stats;
  if (stats[from] <= 0) throw new Error(`Invalid ${from} campaign count.`);
  return { ...stats, [from]: stats[from] - 1, [to]: stats[to] + 1 };
}

export function remainingToday(cap: number, used: number): number {
  return Math.max(0, cap - used);
}
