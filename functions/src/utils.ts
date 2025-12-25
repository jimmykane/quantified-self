import * as functions from 'firebase-functions/v1';
type Request = functions.https.Request;
type Response = functions.Response;
import * as admin from 'firebase-admin';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import {
  COROSAPIEventMetaData,
  GarminHealthAPIEventMetaData,
  SuuntoAppEventMetaData
} from '@sports-alliance/sports-lib';

import * as crypto from 'crypto';
import * as base58 from 'bs58';
import { EventWriter, FirestoreAdapter, StorageAdapter } from './shared/event-writer';
import { getFunctions } from 'firebase-admin/functions';
import { ServiceNames } from '@sports-alliance/sports-lib';


export function generateIDFromPartsOld(parts: string[]): string {
  return base58.encode(Buffer.from(`${parts.join(':')}`));
}

export function generateIDFromParts(parts: string[], algorithm = 'sha256'): string {
  return crypto.createHash(algorithm).update(parts.join(':')).digest('hex');
}

export async function getUserIDFromFirebaseToken(req: Request): Promise<string | null> {
  console.log('Check if request is authorized with Firebase ID token');

  if ((!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) &&
    !(req.cookies && req.cookies.__session)) {
    console.error('No Firebase ID token was passed as a Bearer token in the Authorization header.',
      'Make sure you authorize your request by providing the following HTTP header:',
      'Authorization: Bearer <Firebase ID Token>',
      'or by passing a "__session" cookie.');
    return null;
  }

  let idToken;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    console.log('Found "Authorization" header');
    // Read the ID Token from the Authorization header.
    idToken = req.headers.authorization.split('Bearer ')[1];
  } else if (req.cookies) {
    console.log('Found "__session" cookie');
    // Read the ID Token from cookie.
    idToken = req.cookies.__session;
  } else {
    // No cookie
    return null;
  }

  try {
    const decodedIdToken = await admin.auth().verifyIdToken(idToken);
    console.log('ID Token correctly decoded');

    return decodedIdToken.uid;
  } catch (error) {
    console.error('Error while verifying Firebase ID token:', error);
    return null;
  }
}

export function determineRedirectURI(req: Request): string {
  return String(req.query.redirect_uri); // @todo should check for authorized redirects as well
}

export function setAccessControlHeadersOnResponse(req: Request, res: Response) {
  res.set('Access-Control-Allow-Origin', `${req.get('origin')}`);
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'origin, content-type, accept, authorization');
  return res;
}

export const ALLOWED_CORS_ORIGINS: (string | RegExp)[] = [
  'https://quantified-self.io',
  'https://beta.quantified-self.io',
  /https?:\/\/localhost:\d+/
];

export function isCorsAllowed(req: Request) {
  const origin = <string>req.get('origin') || '';
  return ALLOWED_CORS_ORIGINS.some(allowed => {
    if (allowed instanceof RegExp) {
      return allowed.test(origin);
    }
    return allowed === origin;
  });
}

export async function setEvent(userID: string, eventID: string, event: EventInterface, metaData: SuuntoAppEventMetaData | GarminHealthAPIEventMetaData | COROSAPIEventMetaData, originalFile?: { data: any, extension: string, startDate?: Date }, bulkWriter?: admin.firestore.BulkWriter, usageCache?: Map<string, Promise<{ role: string, limit: number, currentCount: number }>>, pendingWrites?: Map<string, number>) {
  // Enforce Usage Limit
  await checkEventUsageLimit(userID, usageCache, pendingWrites);

  event.setID(eventID);

  // Pre-assign Activity IDs to match legacy behavior (deterministic IDs)
  event.getActivities().forEach((activity: ActivityInterface, index: number) => {
    if (!activity.getID()) {
      activity.setID(generateIDFromParts([<string>event.getID(), index.toString()]));
    }
  });


  const adapter: FirestoreAdapter = {
    setDoc: async (path: string[], data: any) => {
      // path is ['users', userID, 'events', eventID, ...]
      let ref: any = admin.firestore();
      for (const part of path) {
        if (ref.collection) {
          ref = ref.collection(part);
        } else {
          ref = ref.doc(part);
        }
      }
      // ref should be a DocumentReference now
      // Iterate path to build reference is tricky with mix of col/doc.
      // Better way:
      // data is strictly set()
      // admin.firestore().doc(path.join('/')) works for simple paths but might fail if IDs have slashes?
      // Our IDs might be base58 or hashes, so safe-ish.
      // Safer to chain:
      // admin.firestore().collection(p0).doc(p1).collection(p2).doc(p3)

      let docRef = admin.firestore().collection(path[0]).doc(path[1]);
      for (let i = 2; i < path.length; i += 2) {
        docRef = docRef.collection(path[i]).doc(path[i + 1]);
      }
      if (bulkWriter) {
        void bulkWriter.set(docRef, data);
      } else {
        await docRef.set(data);
      }
    },
    createBlob: (data: Uint8Array) => {
      return Buffer.from(data);
    },
    generateID: () => {
      return admin.firestore().collection('dummy').doc().id;
    }
  };

  const storageAdapter: StorageAdapter = {
    uploadFile: async (path: string, data: any) => {
      const bucket = admin.storage().bucket();
      const file = bucket.file(path);
      await file.save(data);
    },
    getBucketName: () => {
      return admin.storage().bucket().name;
    }
  };

  const writer = new EventWriter(adapter, storageAdapter);
  await writer.writeAllEventData(userID, event, originalFile);

  // Write Metadata (not handled by EventWriter)
  const metaRef = admin.firestore()
    .collection('users')
    .doc(userID)
    .collection('events')
    .doc(<string>event.getID())
    .collection('metaData')
    .doc(metaData.serviceName);

  if (bulkWriter) {
    void bulkWriter.set(metaRef, metaData.toJSON());
  } else {
    await metaRef.set(metaData.toJSON());
  }
}

/**
 * Creates a Firebase account with the given user profile and returns a custom auth token allowing
 * signing-in this account.
 *
 * @returns {Promise<string>} The Firebase custom auth token in a promise.
 */
export async function createFirebaseAccount(serviceUserID: string) {
  // The UID we'll assign to the user.
  const uid = generateIDFromParts(['suuntoApp', serviceUserID]);

  // Save the access token to the Firestore
  // const databaseTask  = admin.firestore().collection('suuntoAppAccessTokens').doc(`${uid}`).set({accessToken: accessToken});

  // Create or update the user account.
  try {
    await admin.auth().updateUser(uid, {
      displayName: serviceUserID,
      // photoURL: photoURL,
    });
  } catch (e: any) {
    if (e.code === 'auth/user-not-found') {
      await admin.auth().createUser({
        uid: uid,
        displayName: serviceUserID,
        // photoURL: photoURL,
      });
    }
  }
  // Create a Firebase custom auth token.
  const token = await admin.auth().createCustomToken(uid);
  console.log('Created Custom token for UID "', uid, '" Token:', token);
  return token;
}

export async function getUserRole(userID: string): Promise<string> {
  try {
    const userRecord = await admin.auth().getUser(userID);
    const role = userRecord.customClaims?.['stripeRole'] as string;
    // Default to 'free' if no role or role is null
    return role || 'free';
  } catch (e) {
    console.error(`Error fetching user role for ${userID}:`, e);
    return 'free'; // Safe default
  }
}


export class UsageLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageLimitExceededError';
  }
}

import { USAGE_LIMITS } from './shared/limits';

export async function checkEventUsageLimit(userID: string, usageCache?: Map<string, Promise<{ role: string, limit: number, currentCount: number }>>, pendingWrites?: Map<string, number>): Promise<void> {
  const role = await getUserRole(userID);
  if (role === 'pro') return;

  let roleData: { role: string, limit: number, currentCount: number };

  if (usageCache) {
    let usagePromise = usageCache.get(userID);
    if (!usagePromise) {
      usagePromise = (async () => {
        const limit = USAGE_LIMITS[role] || 10;
        const eventsCollection = admin.firestore().collection('users').doc(userID).collection('events');
        const snapshot = await eventsCollection.count().get();
        return { role, limit, currentCount: snapshot.data().count };
      })();
      usageCache.set(userID, usagePromise);
    }
    roleData = await usagePromise;
  } else {
    const limit = USAGE_LIMITS[role] || 10;
    const eventsCollection = admin.firestore().collection('users').doc(userID).collection('events');
    const snapshot = await eventsCollection.count().get();
    roleData = { role, limit, currentCount: snapshot.data().count };
  }

  const { limit, currentCount } = roleData;

  // Pro: Unlimited
  if (role === 'pro') return;

  const currentPending = (pendingWrites?.get(userID) || 0);
  const totalCount = currentCount + currentPending;

  console.log(`[UsageCheck] User: ${userID}, Role: ${role}, Count: ${currentCount}, Pending: ${currentPending}, Limit: ${limit}`);

  if (totalCount >= limit) {
    throw new UsageLimitExceededError(`Upload limit reached for ${role} tier. You have ${currentCount} events (+${currentPending} pending). Limit is ${limit}. Please upgrade to upload more.`);
  }

  // If we passed the check, increment pending writes
  if (pendingWrites) {
    pendingWrites.set(userID, currentPending + 1);
  }
}


export async function assertProServiceAccess(userID: string): Promise<void> {
  const role = await getUserRole(userID);
  if (role !== 'pro') {
    throw new Error(`Service sync is a Pro feature. Your current role is: ${role}. Please upgrade to Pro.`);
  }
}

/**
 * Enqueues a task to process a single workout queue item.
 * @param serviceName The service (Garmin, Suunto, Coros)
 * @param queueItemId The ID of the document in the {serviceName}Queue collection
 */
export async function enqueueWorkoutTask(serviceName: ServiceNames, queueItemId: string) {
  try {
    const queue = getFunctions().taskQueue('processWorkoutTask', 'europe-west2');
    await queue.enqueue({
      queueItemId,
      serviceName,
    });
    console.log(`[Dispatcher] Successfully enqueued task for ${serviceName}:${queueItemId}`);
  } catch (error) {
    // We don't throw here to avoid failing the webhook entirely.
    // The "Safety Net" polling will pick it up later if dispatch fails.
    console.error(`[Dispatcher] Failed to enqueue task for ${serviceName}:${queueItemId}:`, error);
  }
}





