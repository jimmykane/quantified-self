import * as functions from 'firebase-functions';
import { addToQueueForCOROS, parseQueueItems } from '../queue';
import { SERVICE_NAME } from './constants';
import { COROSAPIWorkoutQueueItemInterface } from '../queue/queue-item.interface';
import { generateIDFromParts } from '../utils';


const TIMEOUT_IN_SECONDS = 300;
const MEMORY = '2GB';
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
    console.info(`No client or secret ${req.method}`);
    res.status(200).send(SUCCESS_RESPONSE);
    return;
  }
  //
  if (!(req.get('Client') === functions.config().corosapi.client_id &&
    req.get('Secret') === functions.config().corosapi.client_secret)) {
    console.info('Client Cred error return just 200'); // as status check
    res.status(200).send(SUCCESS_RESPONSE);
    return;
  }

  const body = JSON.parse(JSON.stringify(req.body));

  console.log(JSON.stringify(req.body));

  if (!body.sportDataList || !body.sportDataList.length) {
    console.error('No sport data list');
    res.status(200).send(SUCCESS_RESPONSE);
    return;
  }

  for (const workout of convertCOROSWorkoutsToQueueItems(body.sportDataList)) {
    try {
      await addToQueueForCOROS(workout);
    } catch (e: any) {
      console.error(e);
      res.status(500).send();
      return;
    }
  }
  // All ok
  console.info('Insert to Queue for COROS success responding with ok');
  res.status(200).send(SUCCESS_RESPONSE);
});

export const parseCOROSAPIWorkoutQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_IN_SECONDS,
  memory: MEMORY,
  maxInstances: 1,
}).pubsub.schedule('every 20 minutes').onRun(async (context) => {
  await parseQueueItems(SERVICE_NAME);
});

export const parseCOROSAPIHistoryImportWorkoutQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_IN_SECONDS,
  memory: MEMORY,
  maxInstances: 1,
}).pubsub.schedule('every 20 minutes').onRun(async (context) => {
  await parseQueueItems(SERVICE_NAME, true);
});

export function convertCOROSWorkoutsToQueueItems(workouts: any[], openId?: string): COROSAPIWorkoutQueueItemInterface[] {
  // find the triathlon
  const triathlon = workouts
    .filter(((workoutData: any) => workoutData.triathlonItemList))
    .reduce((accu: COROSAPIWorkoutQueueItemInterface[], triathlonWorkout: any) => {
      triathlonWorkout.triathlonItemList.forEach((triathlonWorkoutItem: any) => {
        accu.push(getCOROSQueueItemFromWorkout(openId || triathlonWorkout.openId, triathlonWorkout.labelId, triathlonWorkoutItem.fitUrl));
      });
      return accu;
    }, []);

  const nonTriathlon = workouts
    .filter(((workoutData: any) => !workoutData.triathlonItemList)).map((workout: any) => getCOROSQueueItemFromWorkout(openId || workout.openId, workout.labelId, workout.fitUrl));
  return [...triathlon, ...nonTriathlon].filter((workout) => {
    if (!workout.FITFileURI) {
      console.error(`No fit url skipping workout for user ${workout.openId}, id ${workout.workoutID}`);
      return false;
    }
    return true;
  });
}

export function getCOROSQueueItemFromWorkout(openId: string, labelId: string, fitUrl: string): COROSAPIWorkoutQueueItemInterface {
  return {
    id: generateIDFromParts([openId, labelId, fitUrl]),
    dateCreated: new Date().getTime(),
    openId: openId,
    workoutID: labelId,
    FITFileURI: fitUrl,
    retryCount: 0, // So it can be re-processed
    processed: false, // So it can be re-processed
  };
}
