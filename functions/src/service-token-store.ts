import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getServiceAdapter } from './auth/factory';

function hasPendingOAuthFlowContext(snapshot: admin.firestore.DocumentSnapshot): boolean {
  if (!snapshot.exists) {
    return false;
  }

  const data = snapshot.data() as Record<string, unknown> | undefined;
  const state = typeof data?.state === 'string' ? data.state.trim() : '';
  const codeVerifier = typeof data?.codeVerifier === 'string' ? data.codeVerifier.trim() : '';
  return state.length > 0 || codeVerifier.length > 0;
}

export interface DeleteLocalServiceTokenOptions {
  preserveOAuthFlowContext?: boolean;
  shouldDeleteInTransaction?: (transaction: admin.firestore.Transaction) => Promise<boolean>;
}

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

export interface DeleteLocalServiceTokenResult {
  tokenRootDeleted: boolean;
  tokenRootPreservedForOAuthFlow: boolean;
  remainingTokenCount: number;
  skippedByCondition: boolean;
}

export async function deleteLocalServiceToken(
  userID: string,
  serviceName: ServiceNames,
  tokenID: string,
  options: DeleteLocalServiceTokenOptions = {},
): Promise<DeleteLocalServiceTokenResult> {
  logger.info(`Starting delete for local token ${tokenID} for ${userID} and serviceName ${serviceName}`);

  const userDocRef = getServiceTokenRootDocumentRef(userID, serviceName);
  const tokenCollectionRef = userDocRef.collection('tokens');
  const tokenDocRef = tokenCollectionRef.doc(tokenID);

  return admin.firestore().runTransaction(async (transaction) => {
    if (options.shouldDeleteInTransaction && !(await options.shouldDeleteInTransaction(transaction))) {
      return {
        tokenRootDeleted: false,
        tokenRootPreservedForOAuthFlow: false,
        remainingTokenCount: 0,
        skippedByCondition: true,
      };
    }

    const tokenRootSnapshot = await transaction.get(userDocRef);
    const tokenQuerySnapshot = await transaction.get(tokenCollectionRef);
    const remainingTokenCount = tokenQuerySnapshot.docs.filter((doc) => doc.id !== tokenID).length;
    const shouldPreserveOAuthFlowContext = options.preserveOAuthFlowContext !== false;
    const tokenRootPreservedForOAuthFlow = shouldPreserveOAuthFlowContext
      && remainingTokenCount === 0
      && hasPendingOAuthFlowContext(tokenRootSnapshot);

    transaction.delete(tokenDocRef);

    if (remainingTokenCount === 0 && !tokenRootPreservedForOAuthFlow) {
      // Service token roots only store root fields plus the `tokens` subcollection.
      // After deleting the final token doc in this transaction, no descendants remain on the root.
      transaction.delete(userDocRef);
    }

    logger.info(`Remaining tokens for ${userID}: ${remainingTokenCount}`);
    if (tokenRootPreservedForOAuthFlow) {
      logger.info(`Preserving ${serviceName} token root for ${userID} because an OAuth reconnect flow is already in progress.`);
    }

    return {
      tokenRootDeleted: remainingTokenCount === 0 && !tokenRootPreservedForOAuthFlow,
      tokenRootPreservedForOAuthFlow,
      remainingTokenCount,
      skippedByCondition: false,
    };
  });
}
