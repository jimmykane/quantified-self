export const INACTIVITY_MODES = ['off', 'dry-run', 'warnings-only', 'enforce'] as const;
export type InactivityMode = typeof INACTIVITY_MODES[number];
export const INACTIVITY_ADMIN_VIEWS = ['queued', 'warned', 'cancelled', 'pending-deletion', 'eligible'] as const;
export type InactivityAdminView = typeof INACTIVITY_ADMIN_VIEWS[number];
export const INACTIVITY_WARNING_LIMIT = 100;
export const INACTIVITY_DELETION_LIMIT = 25;
export const INACTIVITY_ADMIN_PAGE_SIZE = 25;

export interface InactivitySettings {
    mode: InactivityMode;
    warningDailyLimit: number;
    deletionDailyLimit: number;
    revision: number;
}
export interface InactivityAdminRequest {
    view: InactivityAdminView;
    afterUid?: string;
    dryRunId?: string;
    projection?: 'login-order';
    accountUids?: string[];
}
export interface InactivityLoginEntry { uid: string; lastLoginAt: number | null }
export interface InactivityAdminAccount {
    uid: string;
    email: string | null;
    authPresent: boolean;
    eventCount: number | null;
    queuedAt: number | null;
    acceptedAt: number | null;
    deleteAfter: number | null;
    requestedAt: number | null;
    detail: string;
}
export type InactivityScanStatus = 'off' | 'waiting' | 'scanning' | 'continuation-pending' | 'daily-limit'
    | 'complete' | 'incomplete' | 'failed';
export interface InactivityAdminResponse {
    scanStatus: InactivityScanStatus;
    dailyLimitReached: boolean;
    settings: InactivitySettings;
    settingsValid: boolean;
    running: boolean;
    lastStartedAt: number | null;
    lastFinishedAt: number | null;
    lastScanCompletedAt: number | null;
    lastCompletedDryRun: { id: string; finishedAt: number; eligibleCount: number } | null;
    budgetDay: string | null;
    warningsReserved: number;
    deletionsReserved: number;
    lastRun: { finishedAt: number; outcome: 'completed' | 'failed'; queued: number; accepted: number;
        deletionRequested: number; blocked: number; failed: number; noticeUnconfirmed: number;
        overdue: number; reviewRequired: number; capped: boolean } | null;
    accounts: InactivityAdminAccount[];
    nextUid: string | null;
    loginOrder?: InactivityLoginEntry[];
}
