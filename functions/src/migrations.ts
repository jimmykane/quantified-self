// import * as functions from "firebase-functions";
// import * as admin from "firebase-admin";
// import {DataActivityTypes} from "'@sports-alliance/sports-lib/lib/data/data.activity-types";
// import {DataDeviceNames} from "'@sports-alliance/sports-lib/lib/data/data.device-names";
//
// export const migrateDates = functions.region('europe-west2').runWith({timeoutSeconds: 180}).pubsub.schedule('every 2 hours').onRun(async (context) => {
//   return;
//   // @todo delete indexes
//   const querySnapshot = await admin.firestore()
//     .collectionGroup(`events`)
//     .where("startDate", "<=", (new Date().toJSON()))
//     .where("startDate", ">=", (new Date(0).toJSON()))
//     .limit(500)
//     .get();
//   console.log(`Found ${querySnapshot.size} to process`);
//   let count = 0;
//   const batch = admin.firestore().batch();
//   for (const doc of querySnapshot.docs) {
//     batch.update(doc.ref, {
//       startDate: (new Date(doc.data().startDate)).getTime(),
//       endDate: (new Date(doc.data().endDate)).getTime()
//     });
//     // await getTokenData(eventDoc, true);
//     // console.log(`Parsed ${doc.id} for ${doc.ref.parent.parent.id} and ${doc.ref.parent.parent.parent.id}  ${doc.ref.parent.parent.parent.parent.id}`);
//
//     count++;
//   }
//   try {
//     await batch.commit();
//   } catch (e: any) {
//     console.log(e)
//   }
//   console.log(`Parsed ${count} docs out of ${querySnapshot.size} and a total of writes`);
// });
//
//
// export const migrateTypesDevices = functions.region('europe-west2').runWith({timeoutSeconds: 180}).pubsub.schedule('every 200 days').onRun(async (context) => {
//
//   return ;
//   let lastDoc;
//   for (let i = 0; i < 5000; i++) {
//     console.log(`Going over the ${i+1} 400`)
//     let eventQuery = admin.firestore()
//       .collectionGroup(`events`)
//       .limit(400);
//
//     if (lastDoc){
//       eventQuery = eventQuery.startAfter(lastDoc)
//     }
//     const eventQuerySnapshot = await eventQuery.get();
//     // const querySnapshot = await admin.firestore()
//     //   .collectionGroup(`events`)
//     //   .limit(10)
//     //   .get();
//     if (eventQuerySnapshot.size === 0){
//       console.log(`empty`)
//       break;
//     }
//     console.log(`Found ${eventQuerySnapshot.size} events to process`);
//     lastDoc = eventQuerySnapshot.docs[eventQuerySnapshot.docs.length - 1];
//     let count = 0;
//     const batch = admin.firestore().batch();
//     for (const eventDoc of eventQuerySnapshot.docs) {
//       const activitiesQuerySnapshot = await eventDoc.ref.collection('activities').get();
//       console.log(`Found ${activitiesQuerySnapshot.size} activities for event ${eventDoc.id}`)
//       const activityTypes = [];
//       const deviceTypes = [];
//       for (const activityDoc of activitiesQuerySnapshot.docs) {
//         activityTypes.push(activityDoc.data().type)
//         deviceTypes.push(activityDoc.data().creator.name)
//       }
//
//       const eventStats = eventDoc.data().statsToShow;
//       try {
//         eventStats[DataActivityTypes.type] = activityTypes;
//         eventStats[DataDeviceNames.type] = deviceTypes;
//         batch.update(eventDoc.ref, {
//           statsToShow: eventStats
//         });
//         count++;
//       } catch (e: any) {
//         console.error(e);
//         continue; // 3cPQA91MbTn2CvY9jKagmebNAWiwZYYHYJAe36VusMuviz4
//       }
//     }
//
//     try {
//       await batch.commit();
//     } catch (e: any) {
//       console.log(e)
//     }
//     console.log(`Parsed ${count} docs out of ${eventQuerySnapshot.size} and a total of writes`);
//   }
// });

//
// export const migrateMerges = functions.region('europe-west2').runWith({timeoutSeconds: 180}).pubsub.schedule('every 2 hours').onRun(async (context) => {
//   // return;
//   // @todo delete indexes
//   const querySnapshot = await admin.firestore()
//     .collectionGroup(`events`)
//     // .collection('users').doc('M8gxUABg0UXQyVlFyhNMBsvl8bm1')
//     // .collection('events')
//     .orderBy("name").where("name", '>=',  'Merged at')
//     .limit(400)
//     .get();
//   console.log(`Found ${querySnapshot.size} to process`);
//   let count = 0;
//   const batch = admin.firestore().batch();
//   for (const doc of querySnapshot.docs) {
//     batch.update(doc.ref, {
//       name: 'Merged Event',
//       isMerge: true
//     });
//     // await getTokenData(eventDoc, true);
//     // console.log(`Parsed ${doc.id} for ${doc.ref.parent.parent.id} and ${doc.ref.parent.parent.parent.id}  ${doc.ref.parent.parent.parent.parent.id}`);
//
//     count++;
//   }
//   try {
//     await batch.commit();
//   } catch (e: any) {
//     console.log(e)
//   }
//   console.log(`Parsed ${count} docs out of ${querySnapshot.size} and a total of writes`);
// });
