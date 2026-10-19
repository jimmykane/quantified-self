import { ServiceNames } from '@sports-alliance/sports-lib';
import { getServiceConnectionMeta } from '../service-connection-meta';
import { getServiceTokenRootDocumentRef } from '../service-token-store';

/** Missing one account's token alone does not prove a Suunto disconnect. */
export async function isSuuntoImportDisconnected(userID: string): Promise<boolean> {
  const meta = await getServiceConnectionMeta(userID, ServiceNames.SuuntoApp);
  if (meta?.connectionState !== undefined
    || typeof meta?.connectionStateGeneration !== 'string' || !meta.connectionStateGeneration.trim()
    || typeof meta.connectionAccountsRevisionKey !== 'string' || !meta.connectionAccountsRevisionKey.trim()
    || !Array.isArray(meta.connectionAccounts) || meta.connectionAccounts.length !== 0) return false;

  // Suunto supports several accounts and may retain an empty OAuth root.
  // Require the entire owner's credential set to be empty, not root absence.
  const tokens = await getServiceTokenRootDocumentRef(userID, ServiceNames.SuuntoApp)
    .collection('tokens').select().limit(1).get();
  return tokens.empty;
}
