export interface RouteProviderSendResult {
  providerRouteId?: string;
  /** False while a multi-account provider batch still has accounts to visit. */
  complete?: boolean;
  /**
   * No provider request was made because a user-triggered resend already has
   * durable acceptance receipts for every eligible destination account.
   */
  alreadyAccepted?: boolean;
  deliveries?: Array<{
    providerUserId?: string | null;
    providerRouteId?: string | null;
  }>;
}

/** Called immediately after a provider confirms route acceptance. */
export type RouteProviderAcceptanceHandler = (
  result: RouteProviderSendResult,
) => Promise<void>;
