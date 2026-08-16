/**
 * An empty allowlist keeps COROS route delivery production-wide. Populate it
 * only for an intentional staged rollout or operational rollback.
 */
export const COROS_ROUTE_UPLOAD_ALLOWED_UIDS: ReadonlyArray<string> = [];

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
