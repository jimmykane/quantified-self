import * as functions from 'firebase-functions/v1';
import { addToQueueForSuunto } from '../queue';

import { ServiceNames } from '@sports-alliance/sports-lib';
import { config } from '../config';

const TIMEOUT_IN_SECONDS = 540;
const MEMORY = '4GB';

export const insertSuuntoAppActivityToQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: 60,
  memory: '256MB',
}).https.onRequest(async (req, res) => {
  // Check Auth first
  const authentication = `Basic ${Buffer.from(`${config.suuntoapp.client_id}:${config.suuntoapp.client_secret}`).toString('base64')}`;
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


