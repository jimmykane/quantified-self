import * as functions from 'firebase-functions';
import { addToQueueForSuunto, parseQueueItems } from '../queue';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';

const TIMEOUT_IN_SECONDS = 540;
const MEMORY = '4GB';

export const insertSuuntoAppActivityToQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: 60,
  memory: '256MB',
}).https.onRequest(async (req, res) => {
  // Check Auth first
  const authentication = `Basic ${Buffer.from(`${functions.config().suuntoapp.client_id}:${functions.config().suuntoapp.client_secret}`).toString('base64')}`;
  if (authentication !== req.headers.authorization) {
    console.error(new Error(`Not authorised to post here received: ${req.headers.authorization}`));
    res.status(403);
    res.send();
    return;
  }

  const userName = req.query.username || req.body.username;
  const workoutID = req.query.workoutid || req.body.workoutid;

  console.log(`Inserting to queue or processing ${workoutID} for ${userName}`);
  let queueItemDocumentReference;
  try {
    queueItemDocumentReference = await addToQueueForSuunto({
      userName: userName,
      workoutID: workoutID,
    });
  } catch (e: any) {
    console.error(e);
    res.status(500).send();
    return;
  }

  console.log(`Inserted to queue ${queueItemDocumentReference.id} for workoutID ${workoutID} and userName ${userName}`);
  res.status(200).send();
});

export const parseSuuntoAppActivityQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_IN_SECONDS,
  memory: MEMORY,
  maxInstances: 1,
}).pubsub.schedule('every 20 minutes').onRun(async (context) => {
  await parseQueueItems(ServiceNames.SuuntoApp);
});

export const parseSuuntoAppHistoryImportActivityQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_IN_SECONDS,
  memory: MEMORY,
  maxInstances: 1,
}).pubsub.schedule('every 20 minutes').onRun(async (context) => {
  await parseQueueItems(ServiceNames.SuuntoApp, true);
});
