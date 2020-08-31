import * as functions from 'firebase-functions'
import { parseQueueItems } from '../queue';
import { SERVICE_NAME } from './constants';


const TIMEOUT_IN_SECONDS = 300;
const MEMORY = "2GB";
//
// export const insertSuuntoAppActivityToQueue = functions.region('europe-west2').runWith({
//   timeoutSeconds: 60,
//   memory: '256MB'
// }).https.onRequest(async (req, res) => {
//   // Check Auth first
//   const authentication = `Basic ${Buffer.from(`${functions.config().suuntoapp.client_id}:${functions.config().suuntoapp.client_secret}`).toString('base64')}`;
//   if (authentication !== req.headers.authorization){
//     console.error(new Error(`Not authorised to post here received: ${req.headers.authorization}`));
//     res.status(403);
//     res.send();
//     return;
//   }
//
//   const userName = req.query.username ||  req.body.username;
//   const workoutID = req.query.workoutid ||  req.body.workoutid;
//
//   console.log(`Inserting to queue or processing ${workoutID} for ${userName}`);
//   let queueItemDocumentReference;
//   try {
//     queueItemDocumentReference = await addToQueueForSuunto({
//       userName: userName,
//       workoutID: workoutID,
//     });
//   }catch (e) {
//     console.error(e);
//     res.status(500).send();
//     return
//   }
//
//   console.log(`Inserted to queue ${queueItemDocumentReference.id} for workoutID ${workoutID} and userName ${userName}`);
//   res.status(200).send()
// })

export const parseCOROSAPIWorkoutQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_IN_SECONDS,
  memory: MEMORY
}).pubsub.schedule('every 10 minutes').onRun(async (context) => {
  await parseQueueItems(SERVICE_NAME);
});
