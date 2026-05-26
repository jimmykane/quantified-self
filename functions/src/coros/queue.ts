import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as crypto from 'crypto';
import { addToQueueForCOROS } from '../queue';
import { isProviderQueueSkippedWithoutRetryError } from '../queue/provider-queue-errors';

import { COROSAPIWorkoutQueueItemInterface } from '../queue/queue-item.interface';
import { generateIDFromParts } from '../utils';
import { config } from '../config';

const SUCCESS_RESPONSE = {
  'message': 'ok',
  'result': '0000',
};

function redactProviderUserId(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const trimmed = value.trim();
  return `sha256:${crypto.createHash('sha256').update(trimmed).digest('hex').slice(0, 12)}`;
}

function countMissingFitUrls(workouts: any[]): number {
  return workouts.reduce((total, workout) => {
    if (Array.isArray(workout?.triathlonItemList)) {
      return total + workout.triathlonItemList.filter((item: any) => !item?.fitUrl).length;
    }
    return total + (workout?.fitUrl ? 0 : 1);
  }, 0);
}

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
  const sportDataList = Array.isArray(body.sportDataList) ? body.sportDataList : [];

  logger.info('COROS workout webhook received', {
    provider: 'COROS',
    sportDataCount: sportDataList.length,
    providerUserIds: Array.from(new Set(sportDataList
      .map((workout: any) => redactProviderUserId(workout?.openId))
      .filter((openId: string | null): openId is string => !!openId))),
  });

  if (!sportDataList.length) {
    logger.error('No sport data list');
    res.status(200).send(SUCCESS_RESPONSE);
    return;
  }

  const queueItems = await convertCOROSWorkoutsToQueueItems(sportDataList);
  let queuedCount = 0;
  let skippedCount = 0;
  for (const workout of queueItems) {
    try {
      await addToQueueForCOROS(workout);
      queuedCount++;
    } catch (e: any) {
      if (isProviderQueueSkippedWithoutRetryError(e)) {
        skippedCount++;
        logger.warn('Skipping COROS workout webhook because no local token/user is connected or the user is being deleted.', {
          provider: 'COROS',
          reason: e.code,
          workoutID: workout.workoutID,
          providerUserId: redactProviderUserId(workout.openId),
        });
        continue;
      }
      logger.error(e);
      res.status(500).send();
      return;
    }
  }
  // All ok
  logger.info('Insert to Queue for COROS success responding with ok', {
    provider: 'COROS',
    queuedCount,
    skippedCount,
    convertedQueueItemCount: queueItems.length,
    missingFitUrlCount: countMissingFitUrls(sportDataList),
  });
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
      logger.error('No fit url skipping COROS workout', {
        provider: 'COROS',
        providerUserId: redactProviderUserId(workout.openId),
        workoutID: workout.workoutID,
      });
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
