import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import {generateIDFromParts} from "./utils";
//
export const migrateDates = functions.region('europe-west2').runWith({timeoutSeconds: 180}).pubsub.schedule('every 2 hours').onRun(async (context) => {
  // @todo delete indexes
  const querySnapshot = await admin.firestore()
    .collectionGroup(`events`)
    .where("startDate", "<=", (new Date().toJSON()))
    .where("startDate", ">=", (new Date(0).toJSON()))
    .limit(500)
    .get();
  console.log(`Found ${querySnapshot.size} auth tokens to process`);
  let count = 0;
  const batch = admin.firestore().batch();
  for (const doc of querySnapshot.docs) {
    batch.update(doc.ref, {
      startDate: (new Date(doc.data().startDate)).getTime(),
      endDate: (new Date(doc.data().endDate)).getTime()
    });
    // await getTokenData(eventDoc, true);
    console.log(`Parsed ${doc.id} for ${doc.ref.parent.parent.id} and ${doc.ref.parent.parent.parent.id}  ${doc.ref.parent.parent.parent.parent.id}`);

    count++;
  }
  try {
    await batch.commit();
  } catch (e) {
    console.log(e)
  }
  console.log(`Parsed ${count} docs out of ${querySnapshot.size} and a total of writes`);
});
