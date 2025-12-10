import * as functions from 'firebase-functions/v1';
type Request = functions.https.Request;
type Response = functions.Response;
import * as admin from 'firebase-admin';
import { EventInterface } from '@sports-alliance/sports-lib/lib/events/event.interface';
import { ActivityInterface } from '@sports-alliance/sports-lib/lib/activities/activity.interface';
import { StreamInterface } from '@sports-alliance/sports-lib/lib/streams/stream.interface';
import {
  COROSAPIEventMetaData,
  GarminHealthAPIEventMetaData,
  SuuntoAppEventMetaData,
} from '@sports-alliance/sports-lib/lib/meta-data/meta-data';
import * as Pako from 'pako';
import { StreamJSONInterface } from '@sports-alliance/sports-lib/lib/streams/stream';
import { getSize } from '@sports-alliance/sports-lib/lib/events/utilities/helpers';
import {
  CompressedJSONStreamInterface,
  CompressionEncodings, CompressionMethods,
} from '@sports-alliance/sports-lib/lib/streams/compressed.stream.interface';
import * as crypto from 'crypto';
import * as base58 from 'bs58';

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
  const writePromises: Promise<any>[] = [];
  event.setID(eventID);
  event.getActivities()
    .forEach((activity: ActivityInterface, index: number) => {
      activity.setID(generateIDFromParts([<string>event.getID(), index.toString()]));
      writePromises.push(
        admin.firestore().collection('users')
          .doc(userID)
          .collection('events')
          .doc(<string>event.getID())
          .collection('activities')
          .doc(<string>activity.getID())
          .set(activity.toJSON()));

      activity.getAllExportableStreams().forEach((stream: StreamInterface) => {
        // console.log(`Stream ${stream.type} has size of GZIP ${getSize(Buffer.from((Pako.gzip(JSON.stringify(stream.data), {to: 'string'})), 'binary'))}`);
        writePromises.push(
          admin.firestore()
            .collection('users')
            .doc(userID)
            .collection('events')
            .doc(<string>event.getID())
            .collection('activities')
            .doc(<string>activity.getID())
            .collection('streams')
            .doc(stream.type)
            .set(StreamEncoder.compressStream(stream.toJSON())));
      });
    });
  writePromises.push(admin.firestore()
    .collection('users')
    .doc(userID)
    .collection('events')
    .doc(<string>event.getID()).collection('metaData').doc(metaData.serviceName).set(metaData.toJSON()));
  try {
    await Promise.all(writePromises);
    console.log(`Wrote ${writePromises.length + 1} documents for event with id ${eventID}`);
    return admin.firestore().collection('users').doc(userID).collection('events').doc(<string>event.getID()).set(event.toJSON());
  } catch (e: any) {
    console.error(e);
    throw e;
    // Try to delete the parent entity and all subdata
    // await this.deleteAllEventData(user, event.getID());
  }
}

/**
 * Creates a Firebase account with the given user profile and returns a custom auth token allowing
 * signing-in this account.
 *
 * @returns {Promise<string>} The Firebase custom auth token in a promise.
 */
export async function createFirebaseAccount(serviceUserID: string, accessToken: string) {
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


export class StreamEncoder {
  /**
   * Make sure this is in sync with the functions based one
   * @param stream
   */
  static compressStream(stream: StreamJSONInterface): CompressedJSONStreamInterface {
    const compressedStream: CompressedJSONStreamInterface = {
      encoding: CompressionEncodings.None,
      type: stream.type,
      data: JSON.stringify(stream.data),
      compressionMethod: CompressionMethods.None,
    };
    // console.log(`[ORIGINAL] ${stream.type} = ${getSizeFormated(compressedStream.data)}`)
    // If we can fit it go on
    if (getSize(compressedStream.data) <= 1048487) {
      return compressedStream;
    }
    // Then try Pako (as the fastest)
    compressedStream.data = Buffer.from(Pako.gzip(JSON.stringify(stream.data)));
    compressedStream.encoding = CompressionEncodings.UInt8Array;
    compressedStream.compressionMethod = CompressionMethods.Pako;
    // console.log(`[COMPRESSED ${CompressionMethods.Pako}] ${stream.type} = ${getSizeFormated(compressedStream.data)}`)
    if (getSize(compressedStream.data) <= 1048487) {
      return compressedStream;
    }
    // Throw an error if smaller than a MB still
    throw new Error(`Cannot compress stream ${stream.type} its more than 1048487 bytes  ${getSize(compressedStream.data)}`);
  }
}
