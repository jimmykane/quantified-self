import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import fetch from 'node-fetch';
import { enforceAppCheck } from '../utils';
import { FUNCTIONS_MANIFEST } from '../../../src/shared/functions-manifest';

export const stWorkoutDownloadAsFit = onCall({
  region: FUNCTIONS_MANIFEST.stWorkoutDownloadAsFit.region,
  cors: true,
  timeoutSeconds: 300,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  enforceAppCheck(request);

  const activityID = request.data.activityID;

  if (!activityID) {
    throw new HttpsError('invalid-argument', 'No activity ID provided.');
  }

  const url = `https://api.sports-tracker.com/apiserver/v1/workout/exportFit/${activityID}?autogeneraterecords=true&generatefillerlaps=true&removesinglelocation=true&removerecordsduringpauses=true&reducepoolswimminglaptypes=true`;
  const opts = {
    method: 'GET',
    headers: {
      'STTAuthorization': '42v8ds44tsim65b4bfog3e8jvfl2u9bj',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.131 Safari/537.36',
    },
  };

  try {
    const response = await fetch(url, opts);
    if (!response.ok) {
      throw new HttpsError('internal', `Sports Tracker API returned ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');

    return { file: base64 };
  } catch (error) {
    logger.error('Error downloading FIT file:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Failed to download FIT file');
  }
});
