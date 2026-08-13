/**
 * COROS route push is kept on a narrow pilot until the production partner
 * application entitlement has been verified. An empty allowlist opens route
 * upload to every authenticated user, matching the other rollout helpers.
 */
export const COROS_ROUTE_UPLOAD_ALLOWED_UIDS: ReadonlyArray<string> = [
    'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
];

export function isCOROSRouteUploadUIDAllowlisted(uid: string): boolean {
    const normalizedUID = `${uid || ''}`.trim();
    if (!normalizedUID) {
        return false;
    }

    if (COROS_ROUTE_UPLOAD_ALLOWED_UIDS.length === 0) {
        return true;
    }

    return COROS_ROUTE_UPLOAD_ALLOWED_UIDS.includes(normalizedUID);
}
