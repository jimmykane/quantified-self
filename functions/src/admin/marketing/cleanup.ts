import type * as admin from 'firebase-admin';
import type { MarketingCampaignStats, MarketingRecipientStatus } from '../../../../shared/admin-marketing';
import { transitionStats } from './core';

/** Remove user-identifying campaign snapshots during account deletion. */
export async function cleanupMarketingCampaignRecipients(db: admin.firestore.Firestore, uid: string): Promise<number> {
  const recipients = await db.collectionGroup('recipients').where('uid', '==', uid).get();
  let removed = 0;
  for (const recipient of recipients.docs) {
    if (!/^marketingCampaigns\/[^/]+\/recipients\/[^/]+$/.test(recipient.ref.path)) continue;
    const campaignRef = recipient.ref.parent.parent!;
    const didRemove = await db.runTransaction(async tx => {
      const [campaign, current] = await Promise.all([tx.get(campaignRef), tx.get(recipient.ref)]);
      if (!current.exists) return false;
      const status = current.get('status') as MarketingRecipientStatus;
      // Preparation can leave a partial audience before counters are published,
      // including after a failed attempt returns to draft. Account erasure must
      // not depend on those uninitialized counters; preparation recounts at commit.
      const countersPublished = campaign.exists && !['draft', 'preparing', 'deleting'].includes(campaign.get('status'));
      if (countersPublished && (status === 'pending' || status === 'queued' || status === 'failed')) {
        tx.update(campaignRef, { stats: transitionStats(campaign.get('stats') as MarketingCampaignStats, status, 'skipped') });
      }
      tx.delete(recipient.ref);
      return true;
    });
    if (didRemove) removed++;
  }
  return removed;
}
