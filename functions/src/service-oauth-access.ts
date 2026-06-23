import { ServiceNames } from '@sports-alliance/sports-lib';
import { isDisconnectPendingServiceConnection } from '../../shared/service-connection';
import { hasProAccess } from './utils';
import { isServiceDisconnectManualReviewRequiredForUser } from './service-disconnect-pending';
import { getServiceConnectionMeta } from './service-connection-meta';

export async function hasServiceOAuthConnectAccess(userID: string, serviceName: ServiceNames): Promise<boolean> {
  if (await hasProAccess(userID)) {
    return true;
  }

  if (await isServiceDisconnectManualReviewRequiredForUser(userID, serviceName)) {
    return true;
  }

  const serviceMeta = await getServiceConnectionMeta(userID, serviceName);
  return isDisconnectPendingServiceConnection(serviceMeta)
    && serviceMeta?.disconnectManualReviewRequired === true;
}
