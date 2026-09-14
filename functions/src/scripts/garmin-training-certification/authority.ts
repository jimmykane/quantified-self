import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { GARMIN_TRAINING_PERMISSION_ISSUE, readTrainingDeliveryAuthority } from '../../training-plans/delivery/connection';
import { TrainingDeliveryTransportError } from '../../training-plans/delivery/contracts';
import { bindingSchema, type Binding, type Config } from './model';

export interface Authority { binding: Binding; accessToken: string; pro: boolean; }
export type ReadAuthority = () => Promise<Authority>;

/** Read-only by design. Unlike production delivery, this operator probe never refreshes
 * tokens, deauthorizes users, or mutates connection metadata. Expiry requires an external
 * normal reconnect/refresh and an explicitly approved same-account preflight. */
export function certificationAuthority(db: Firestore, auth: Pick<Auth, 'getUser' | 'app'>, config: Config,
  now: () => number = Date.now): ReadAuthority {
  return async () => {
    if (auth.app.options.projectId !== config.project) throw new TrainingDeliveryTransportError('auth');
    const user = await auth.getUser(config.uid);
    if (user.uid !== config.uid || user.disabled) throw new TrainingDeliveryTransportError('auth');
    const claims = user.customClaims ?? {};
    const pro = claims.stripeRole === 'pro' || (typeof claims.gracePeriodUntil === 'number'
      && Number.isFinite(claims.gracePeriodUntil) && claims.gracePeriodUntil > now());
    return db.runTransaction(async tx => {
      if ((await getUserDeletionGuardStateInTransaction(db, tx, config.uid, now())).shouldSkip) throw new TrainingDeliveryTransportError('auth');
      const authority = await readTrainingDeliveryAuthority(db, tx, config.uid, 'garmin');
      if (authority.connection.issues?.includes(GARMIN_TRAINING_PERMISSION_ISSUE)) throw new TrainingDeliveryTransportError('permission');
      if (authority.connection.state !== 'connected' || !authority.token) throw new TrainingDeliveryTransportError('auth');
      const token = authority.token.data();
      if (typeof token.accessToken !== 'string' || !token.accessToken.length || token.accessToken.length > 8192 || /[\r\n]/.test(token.accessToken)
        || typeof token.expiresAt !== 'number' || !Number.isFinite(token.expiresAt) || token.expiresAt <= now() + 30_000) throw new TrainingDeliveryTransportError('auth');
      const { destinationKey, generation, epoch } = authority.connection;
      return { binding: bindingSchema.parse({ destinationKey, generation, epoch }), accessToken: token.accessToken, pro };
    // Default transactions give current authority. Firestore's readOnly mode permits
    // snapshots up to 60 seconds old, which is inappropriate for deletion fencing.
    // No writes are staged by this transaction.
    }, { maxAttempts: 3 });
  };
}
