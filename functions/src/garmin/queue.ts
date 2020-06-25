import * as functions from 'firebase-functions';

export const insertToQueueForGarmin = functions.region('europe-west2').https.onRequest(async (req, res) => {
  const userName = req.query.username ||  req.body.username;
  const workoutID = req.query.workoutid ||  req.body.workoutid;

  console.log(`Inserting to queue or processing ${workoutID} for ${userName}`);

  try {
    // Important -> keep the key based on username and workoutid to get updates on activity I suppose ....
    // @todo ask about this
    // const queueItemDocumentReference = await addToQueue(userName, workoutID);
    // await processQueueItem(await queueItemDocumentReference.get());
  }catch (e) {
    console.log(e);
    res.status(500);
  }
  res.status(200).send();
});

// async function addToQueue(workoutUserName: string, workoutID:string): Promise<admin.firestore.DocumentReference>{
//   console.log(`Inserting to queue ${workoutUserName} ${workoutID}`);
//   Important -> keep the key based on username and workoutid to get updates on activity I suppose ....
//   @todo ask  Suunto about this
//   const queueItemDocument = admin.firestore().collection('suuntoAppWorkoutQueue').doc(generateIDFromParts([workoutUserName, workoutID]));
  // await queueItemDocument.set({
  //   userName: workoutUserName,
  //   workoutID: workoutID,
  //   retryCount: 0,
  //   processed: false,
  // });
  // return queueItemDocument;
// }
