import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import { addToQueueForSuunto } from '../queue';

import { config } from '../config';

export const insertSuuntoAppActivityToQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: 60,
  memory: '256MB',
}).https.onRequest(async (req, res) => {
  // Check Auth first
  const authentication = `Basic ${Buffer.from(`${config.suuntoapp.client_id}:${config.suuntoapp.client_secret}`).toString('base64')}`;
  if (authentication !== req.headers.authorization) {
    logger.error(new Error(`Not authorised to post here received: ${req.headers.authorization}`));
    res.status(403);
    res.send();
    return;
  }

  const userName = req.query.username || req.body.username;
  const workoutID = req.query.workoutid || req.body.workoutid;

  logger.info(`Inserting to queue or processing ${workoutID} for ${userName}`);
  let queueItemDocumentReference;
  try {
    queueItemDocumentReference = await addToQueueForSuunto({
      userName: userName,
      workoutID: workoutID,
    });
  } catch (e: any) {
    logger.error(e);
    res.status(500).send();
    return;
  }

  logger.info(`Inserted to queue ${queueItemDocumentReference.id} for workoutID ${workoutID} and userName ${userName}`);
  res.status(200).send();
});


