export type AdminSubscriptionGiftRole = 'basic' | 'pro';
export type AdminSubscriptionGiftCadence = 'monthly' | 'yearly' | 'unknown';
export type AdminSubscriptionGiftSubscriptionStatus = 'active' | 'trialing';
export type AdminSubscriptionGiftOperationStatus = 'applying' | 'succeeded' | 'failed' | 'needs_review';
export type AdminSubscriptionGiftNotificationStatus = 'not_requested' | 'queued' | 'delivered' | 'failed';

export interface PreviewAdminSubscriptionGiftRequest {
    uid: string;
    months: number;
}

export interface AdminSubscriptionGiftHistoryItem {
    operationId: string;
    months: number;
    reason: string;
    actorUid: string;
    status: AdminSubscriptionGiftOperationStatus;
    previousAccessEnd: string;
    newAccessEnd: string;
    notificationStatus: AdminSubscriptionGiftNotificationStatus;
    createdAt: string | null;
}

export interface PreviewAdminSubscriptionGiftResponse {
    uid: string;
    subscriptionId: string;
    role: AdminSubscriptionGiftRole;
    cadence: AdminSubscriptionGiftCadence;
    status: AdminSubscriptionGiftSubscriptionStatus;
    currentAccessEnd: string;
    proposedGiftedEnd: string;
    cancelAtPeriodEnd: boolean;
    previewVersion: string;
    recentHistory: AdminSubscriptionGiftHistoryItem[];
}

export interface GrantAdminSubscriptionGiftRequest {
    uid: string;
    months: number;
    reason: string;
    notifyUser: boolean;
    operationId: string;
    previewVersion: string;
}

export interface GrantAdminSubscriptionGiftResponse {
    operationId: string;
    status: Exclude<AdminSubscriptionGiftOperationStatus, 'applying'>;
    previousAccessEnd: string;
    newAccessEnd: string;
    cancelAtPeriodEnd: boolean;
    notificationStatus: AdminSubscriptionGiftNotificationStatus;
    message?: string;
}
