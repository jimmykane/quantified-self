import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import { addToQueueForCOROS } from '../queue';

import { COROSAPIWorkoutQueueItemInterface } from '../queue/queue-item.interface';
import { generateIDFromParts } from '../utils';
import { config } from '../config';

const SUCCESS_RESPONSE = {
  'message': 'ok',
  'result': '0000',
};

/**
 * We return 200 with no body if there is no sportList
 * We return 200 with a body to respond as processed
 */
export const insertCOROSAPIWorkoutDataToQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: 60,
  memory: '256MB',
}).https.onRequest(async (req, res) => {
  if (!req.get('Client') || !req.get('Secret')) {
    logger.info(`No client or secret ${req.method}`);
    res.status(200).send(SUCCESS_RESPONSE);
    return;
  }
  //
  if (!(req.get('Client') === config.corosapi.client_id &&
    req.get('Secret') === config.corosapi.client_secret)) {
    logger.info('Client Cred error return just 200'); // as status check
    res.status(200).send(SUCCESS_RESPONSE);
    return;
  }

  const body = JSON.parse(JSON.stringify(req.body));

  logger.info(JSON.stringify(req.body));

  if (!body.sportDataList || !body.sportDataList.length) {
    logger.error('No sport data list');
    res.status(200).send(SUCCESS_RESPONSE);
    return;
  }

  for (const workout of await convertCOROSWorkoutsToQueueItems(body.sportDataList)) {
    try {
      await addToQueueForCOROS(workout);
    } catch (e: any) {
      logger.error(e);
      res.status(500).send();
      return;
    }
  }
  // All ok
  logger.info('Insert to Queue for COROS success responding with ok');
  res.status(200).send(SUCCESS_RESPONSE);
});



export async function convertCOROSWorkoutsToQueueItems(workouts: any[], openId?: string): Promise<COROSAPIWorkoutQueueItemInterface[]> {
  // find the triathlon
  const triathlonItems: COROSAPIWorkoutQueueItemInterface[] = [];
  for (const triathlonWorkout of workouts.filter(((workoutData: any) => workoutData.triathlonItemList))) {
    for (const triathlonWorkoutItem of triathlonWorkout.triathlonItemList) {
      triathlonItems.push(await getCOROSQueueItemFromWorkout(openId || triathlonWorkout.openId, triathlonWorkout.labelId, triathlonWorkoutItem.fitUrl));
    }
  }

  const nonTriathlon = await Promise.all(workouts
    .filter(((workoutData: any) => !workoutData.triathlonItemList)).map((workout: any) => getCOROSQueueItemFromWorkout(openId || workout.openId, workout.labelId, workout.fitUrl)));

  return [...triathlonItems, ...nonTriathlon].filter((workout) => {
    if (!workout.FITFileURI) {
      logger.error(`No fit url skipping workout for user ${workout.openId}, id ${workout.workoutID}`);
      return false;
    }
    return true;
  });
}

export async function getCOROSQueueItemFromWorkout(openId: string, labelId: string, fitUrl: string): Promise<COROSAPIWorkoutQueueItemInterface> {
  return {
    id: await generateIDFromParts([openId, labelId, fitUrl]),
    dateCreated: new Date().getTime(),
    openId: openId,
    workoutID: labelId,
    FITFileURI: fitUrl,
    retryCount: 0, // So it can be re-processed
    processed: false, // So it can be re-processed
    dispatchedToCloudTask: null,
  };
}
