import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { onAdminCall } from '../../shared/auth';
import { inactivityAdminRequest, readInactivityAdmin } from '../../users/inactivity-admin';

export const getInactivityAdmin = onAdminCall({
    region: FUNCTIONS_MANIFEST.getInactivityAdmin.region, memory: '256MiB', timeoutSeconds: 60,
}, async request => {
    if ('impersonatedBy' in request.auth!.token) throw new HttpsError('permission-denied', 'Leave impersonation before opening account retention.');
    const input = inactivityAdminRequest(request.data);
    try { return await readInactivityAdmin(admin.firestore(), admin.auth(), input); }
    catch { throw new HttpsError('internal', 'Unable to load account retention. Refresh to try again.'); }
});
