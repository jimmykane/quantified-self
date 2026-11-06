import { createPublicSnapshotFetch } from './public-snapshot-firestore.mjs';
import { main as pricing } from './generate-public-pricing-snapshot.mjs';
import { main as releases } from './generate-public-releases-snapshot.mjs';

try {
  const fetchImpl = await createPublicSnapshotFetch();
  const catalog = await pricing({ fetchImpl });
  const notes = await releases({ fetchImpl });
  console.log(`Generated public snapshots: ${catalog.products.length} products, ${notes.posts.length} published releases.`);
} catch (error) {
  console.error(`Could not generate public snapshots: ${error.message}`);
  process.exitCode = 1;
}
