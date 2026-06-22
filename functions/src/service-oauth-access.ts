import { ServiceNames } from '@sports-alliance/sports-lib';
import { hasProAccess } from './utils';
import { isServiceDisconnectManualReviewRequiredForUser } from './service-disconnect-pending';

export async function hasServiceOAuthConnectAccess(userID: string, serviceName: ServiceNames): Promise<boolean> {
  if (await hasProAccess(userID)) {
    return true;
  }

  return isServiceDisconnectManualReviewRequiredForUser(userID, serviceName);
}
