import * as functions from 'firebase-functions'
import { parseQueueItems } from '../queue';
import { SERVICE_NAME } from './constants';


const TIMEOUT_IN_SECONDS = 300;
const MEMORY = "2GB";

export const insertCOROSAPIWorkoutDataToQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: 60,
  memory: '256MB'
}).https.onRequest(async (req, res) => {
  console.log('Called')
  console.log(req.rawHeaders)
  console.log(req.body);
  console.log(req.body.sportDataList);
  res.status(200).send()
})

export const parseCOROSAPIWorkoutQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_IN_SECONDS,
  memory: MEMORY
}).pubsub.schedule('every 10 minutes').onRun(async (context) => {
  await parseQueueItems(SERVICE_NAME);
});

export function convertCOROSWorkoutsToQueueItems(workouts: any[], openId?: string): COROSAPIWorkoutQueueItemInterface[] {
  // find the triathlon
  const triathlon = workouts
    .filter(((workoutData: any) => workoutData.triathlonItemList))
    .reduce((accu: COROSAPIWorkoutQueueItemInterface[], triathlonWorkout: any) => {
      triathlonWorkout.triathlonItemList.forEach((triathlonWorkoutItem: any) => {
        accu.push(getCOROSQueueItemFromWorkout(openId || triathlonWorkout.openId, triathlonWorkout.labelId, triathlonWorkoutItem.fitUrl))
      })
      return accu
    }, [])

  const nonTriathlon = workouts
    .filter(((workoutData: any) => !workoutData.triathlonItemList)).map((workout: any) =>  getCOROSQueueItemFromWorkout(openId || workout.openId, workout.labelId, workout.fitUrl))
  return [...triathlon, ...nonTriathlon]
}

export function getCOROSQueueItemFromWorkout(openId: string, labelId: string, fitUrl: string): COROSAPIWorkoutQueueItemInterface{
  return {
    id: generateIDFromParts([openId, labelId, fitUrl]),
    dateCreated: new Date().getTime(),
    openId: openId,
    workoutID: labelId,
    FITFileURI: fitUrl,
    retryCount: 0, // So it can be re-processed
    processed: false, //So it can be re-processed
  }
}
