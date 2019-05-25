import * as functions from 'firebase-functions'
import * as admin from "firebase-admin";
import {generateIDFromParts} from "./utils";
import {processQueueItem} from "./parse-queue";


export const insertToQueue = functions.region('europe-west2').runWith({timeoutSeconds: 60}).https.onRequest(async (req, res) => {
  // Check Auth first
  const authentication = `Basic ${Buffer.from(`${functions.config().suuntoapp.client_id}:${functions.config().suuntoapp.client_secret}`).toString('base64')}`;
  if (authentication !== req.headers.authorization){
    console.error(`Not authorised to post here received:  ${req.headers.authorization}` );
    res.status(403);
    res.send();
    return;
  }

  const userName = req.query.username ||  req.body.username;
  const workoutID = req.query.workoutid ||  req.body.workoutid;

  try {
    console.log(`Inserting to queue ${userName} ${workoutID}`);
    // Important -> keep the key based on username and workoutid to get updates on activity I suppose ....
    // @todo ask about this
    const queueItem = admin.firestore().collection('suuntoAppWorkoutQueue').doc(generateIDFromParts([userName, workoutID]));
    await queueItem.set({
      userName: userName,
      workoutID: workoutID,
      retryCount: 0,
      processed: false,
    });
    await processQueueItem(await queueItem.get());
  }catch (e) {
    throw e;
  }
  res.send();
});
