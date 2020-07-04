import * as functions from 'firebase-functions'
import { processSuuntoAppActivityQueueItem } from "./parse-queue";
import { SuuntoAppWorkoutQueueItemInterface } from '../queue/queue-item.interface';
import { addToQueueForSuunto } from '../queue';

const TIMEOUT_IN_SECONDS = 60;
const MEMORY = "256MB";

export const insertSuuntoAppActivityToQueue = functions.region('europe-west2').runWith({timeoutSeconds: TIMEOUT_IN_SECONDS, memory: MEMORY}).https.onRequest(async (req, res) => {
  // Check Auth first
  const authentication = `Basic ${Buffer.from(`${functions.config().suuntoapp.client_id}:${functions.config().suuntoapp.client_secret}`).toString('base64')}`;
  if (authentication !== req.headers.authorization){
    console.error(new Error(`Not authorised to post here received: ${req.headers.authorization}`));
    res.status(403);
    res.send();
    return;
  }

  const userName = req.query.username ||  req.body.username;
  const workoutID = req.query.workoutid ||  req.body.workoutid;

  console.log(`Inserting to queue or processing ${workoutID} for ${userName}`);
  let queueItemDocumentReference;
  try {
    queueItemDocumentReference = await addToQueueForSuunto({
      userName: userName,
      workoutID: workoutID,
    });
  }catch (e) {
    console.error(e);
  }

  if (!queueItemDocumentReference){
    res.status(500).send();
    return
  }

  // All ok reply and take over internally
  res.status(200);
  res.write('SUCCESS');

  try{
    await processSuuntoAppActivityQueueItem(<SuuntoAppWorkoutQueueItemInterface>Object.assign({id: queueItemDocumentReference.id}, (await queueItemDocumentReference.get()).data()));
  }catch (e) {
    console.error(`Could not process activity due to ${e.message}`)
    console.error(e)
  }
});

