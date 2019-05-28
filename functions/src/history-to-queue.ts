'use strict';

import * as functions from 'firebase-functions'
import * as admin from "firebase-admin";
import * as requestPromise from "request-promise-native";
import {ServiceTokenInterface} from "quantified-self-lib/lib/service-tokens/service-token.interface";
import {refreshTokenIfNeeded} from "./service-tokens";
import {generateIDFromParts} from "./utils";


/**
 * Add to the workout queue the workouts of a user for a selected date range
 */
export const addHistoryToQueue = functions.region('europe-west2').https.onRequest(async (req, res) => {
  // Directly set the CORS header
  if (['http://localhost:4200', 'https://quantified-self.io', 'https://beta.quantified-self.io'].indexOf(<string>req.get('origin')) === -1) {
    res.status(403);
    res.send();
    return
  }

  res.set('Access-Control-Allow-Origin', `${req.get('origin')}`);
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'origin, content-type, accept');

  if (req.method === 'OPTIONS') {
    res.status(200);
    res.send();
    return;
  }

  if (req.method !== 'POST') {
    console.error(`Only post is allowed`);
    res.status(403);
    res.send();
    return;
  }

  let decodedIdToken;
  try {
    decodedIdToken = await admin.auth().verifyIdToken(req.body.firebaseAuthToken);
  } catch (e) {
    console.error(e);
    console.error(`Could not verify user token aborting operation`);
    res.status(500);
    res.send();
    return;
  }

  if (!decodedIdToken) {
    console.error(`Could not verify and decode token`);
    res.status(500);
    res.send();
    return;
  }

  const documentSnapshots = await admin.firestore().collection('suuntoAppAccessTokens').doc(decodedIdToken.uid).collection('tokens').get();

  console.log(`Found ${documentSnapshots.size} tokens for user ${decodedIdToken.uid}`);

  // Deauthorize all tokens for that user
  for (const doc of documentSnapshots.docs) {
    await refreshTokenIfNeeded(doc, false);

    // Get the first token
    const data = <ServiceTokenInterface>doc.data();
    let result:any;
    try {
      result = await requestPromise.get({
        headers: {
          'Authorization': data.accessToken,
          'Ocp-Apim-Subscription-Key': functions.config().suuntoapp.subscription_key,
          json: true,
        },
        url: `https://cloudapi.suunto.com/v2/workouts?since=1540504800000&limit=1000000`,
      });
      result = JSON.parse(result);
      // console.log(`Deauthorized token ${doc.id} for ${decodedIdToken.uid}`)
    } catch (e) {
      console.error(`Could not get history for token ${doc.id} for user ${decodedIdToken.uid}`, e);
      res.status(500);
      res.send({result: 'Could not get history'});
      return; // @todo go to next
    }

    if (result.error !== null) {
      console.error(`Could not get history for token ${doc.id} for user ${decodedIdToken.uid} due to service error`, result.error);
      // @todo go to next
    }

    if (result.metadata.workoutcount === 0) {
      // @todo go to next
    }

    console.log(`Found ${result.metadata.workoutcount} for  to  for token ${doc.id} for user ${decodedIdToken.uid}`);

    const batchCount = Math.ceil(result.metadata.workoutcount / 500);
    const batchesToProcess: any[] = [];
    (Array(batchCount)).fill(null).forEach((justNull, index) => {
      const start = index*500;
      const end = (index+1)*500;
      batchesToProcess.push(result.payload.slice(start, end))
    });

    console.log(`Created ${batchCount} batches for token ${doc.id} for user ${decodedIdToken.uid}`)
    for (const batchToProcess of batchesToProcess){
      const batch = admin.firestore().batch();
      for (const payload of batchToProcess){
        batch.set(admin.firestore().collection('suuntoAppWorkoutQueue').doc(generateIDFromParts([data.userName, payload.workoutKey])), {
          userName: data.userName,
          workoutID: payload.workoutKey,
          retryCount: 0,
          processed: false,
        });
      }

      try {
        await batch.commit();
      }catch (e) {
        console.error(`Could not process batch ${doc.id} for user ${decodedIdToken.uid} due to service error aborting`, result.error);
        // @todo resolve somehow
      }
    }
  }

  res.status(200);
  res.send({result: 'Deauthorized'});

});
