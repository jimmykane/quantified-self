export const INACTIVITY_MODES = ['off', 'dry-run', 'warnings-only', 'enforce'] as const;
export type InactivityMode = typeof INACTIVITY_MODES[number];
export const INACTIVITY_ADMIN_VIEWS = ['queued', 'warned', 'cancelled', 'pending-deletion'] as const;
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
export interface InactivityAdminRequest { view: InactivityAdminView; afterUid?: string }
export interface InactivityAdminAccount {
    uid: string;
    email: string | null;
    authPresent: boolean;
    queuedAt: number | null;
    acceptedAt: number | null;
    deleteAfter: number | null;
    requestedAt: number | null;
    detail: string;
}
export interface InactivityAdminResponse {
    settings: InactivitySettings;
    settingsValid: boolean;
    running: boolean;
    lastStartedAt: number | null;
    lastFinishedAt: number | null;
    lastScanCompletedAt: number | null;
    budgetDay: string | null;
    warningsReserved: number;
    deletionsReserved: number;
    lastRun: { finishedAt: number; outcome: 'completed' | 'failed'; queued: number; accepted: number;
        deletionRequested: number; blocked: number; failed: number; noticeUnconfirmed: number;
        overdue: number; reviewRequired: number; capped: boolean } | null;
    accounts: InactivityAdminAccount[];
    nextUid: string | null;
}
