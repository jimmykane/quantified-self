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
