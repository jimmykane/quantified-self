/*
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { ServiceNames } from '@sports-alliance/sports-lib';

/!**
 * Function to reset the retry count of a queue's items for a specific date range
 *!/
// export const resetRetryCountForGarminHealthAPIActivityQueueQueue = functions.region('europe-west2').runWith({timeoutSeconds: 180}).pubsub.schedule('every 15 minutes').onRun(async (context) => {
//   // return
//   const startDate = new Date('07-30-2020');
//   const endDate = new Date();
//   await resetRetryCount(ServiceNames.GarminHealthAPI, startDate, endDate);
// })

async function resetRetryCount(serviceName: ServiceNames, startDate: Date, endDate: Date){
  const querySnapshot = await admin.firestore()
    .collection(serviceName === ServiceNames.SuuntoApp ? 'suuntoAppWorkoutQueue' : 'garminHealthAPIActivityQueue')
    .where("processed", "==", false)
    .where("dateCreated", ">=", startDate.getTime())
    .where("dateCreated", "<=", endDate.getTime())
    .limit(500) // @todo remove and refactor
    .get();
  console.log(`Found ${querySnapshot.size} to process`);
  let count = 0;
  const batch = admin.firestore().batch();
  for (const doc of querySnapshot.docs) {
    batch.update(doc.ref, {
      retryCount: 0,
    });
    count++;
  }
  try {
    await batch.commit();
  } catch (e: any) {
    console.log(e)
  }
  console.log(`Parsed ${count} docs out of ${querySnapshot.size} and a total of writes`);
}
*/
