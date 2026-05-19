import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getServiceAdapter } from './auth/factory';

export function getServiceTokenRootDocumentRef(
  userID: string,
  serviceName: ServiceNames,
): admin.firestore.DocumentReference {
  const adapter = getServiceAdapter(serviceName);
  return admin.firestore().collection(adapter.tokenCollectionName).doc(userID);
}

export function getServiceTokenCollectionRef(
  userID: string,
  serviceName: ServiceNames,
): admin.firestore.CollectionReference {
  return getServiceTokenRootDocumentRef(userID, serviceName).collection('tokens');
}

export async function deleteLocalServiceToken(
  userID: string,
  serviceName: ServiceNames,
  tokenID: string,
): Promise<{ tokenRootDeleted: boolean; remainingTokenCount: number }> {
  logger.info(`Starting delete for local token ${tokenID} for ${userID} and serviceName ${serviceName}`);

  const userDocRef = getServiceTokenRootDocumentRef(userID, serviceName);
  await userDocRef.collection('tokens').doc(tokenID).delete();

  const remainingTokens = await userDocRef.collection('tokens').limit(1).get();
  logger.info(`Remaining tokens for ${userID}: ${remainingTokens.size}`);

  if (remainingTokens.empty) {
    logger.info(`No remaining tokens for ${userID}. Deleting parent document and all descendant data (surgical).`);
    await admin.firestore().recursiveDelete(userDocRef);
  }

  return {
    tokenRootDeleted: remainingTokens.empty,
    remainingTokenCount: remainingTokens.size,
  };
}
