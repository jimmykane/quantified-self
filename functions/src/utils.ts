import * as functions from 'firebase-functions/v1';
type Request = functions.https.Request;
type Response = functions.Response;
import * as admin from 'firebase-admin';
import { EventInterface } from '@sports-alliance/sports-lib/lib/events/event.interface';
import { ActivityInterface } from '@sports-alliance/sports-lib/lib/activities/activity.interface';

import * as crypto from 'crypto';
import * as base58 from 'bs58';
import { EventWriter, FirestoreAdapter } from './shared/event-writer';


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

export function isCorsAllowed(req: Request) {
  return ['http://localhost:4200', 'https://quantified-self.io', 'https://beta.quantified-self.io'].indexOf(<string>req.get('origin')) !== -1;
}

export async function setEvent(userID: string, eventID: string, event: EventInterface, metaData: SuuntoAppEventMetaData | GarminHealthAPIEventMetaData | COROSAPIEventMetaData) {
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
      await docRef.set(data);
    },
    createBlob: (data: Uint8Array) => {
      return Buffer.from(data);
    },
    generateID: () => {
      return admin.firestore().collection('dummy').doc().id;
    }
  };

  const writer = new EventWriter(adapter);
  await writer.writeAllEventData(userID, event);

  // Write Metadata (not handled by EventWriter)
  await admin.firestore()
    .collection('users')
    .doc(userID)
    .collection('events')
    .doc(<string>event.getID())
    .collection('metaData')
    .doc(metaData.serviceName)
    .set(metaData.toJSON());
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



