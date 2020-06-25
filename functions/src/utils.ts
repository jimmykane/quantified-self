import * as base58 from 'bs58';
import { Request, Response } from 'firebase-functions';
import * as admin from "firebase-admin";
import { EventInterface } from '@sports-alliance/sports-lib/lib/events/event.interface';
import { MetaData } from '@sports-alliance/sports-lib/lib/meta-data/meta-data';
import { ActivityInterface } from '@sports-alliance/sports-lib/lib/activities/activity.interface';
import { StreamInterface } from '@sports-alliance/sports-lib/lib/streams/stream.interface';
import * as Pako from 'pako';


// @todo most probably this is not needed
export function generateIDFromParts(parts: string[]): string{
  return base58.encode(Buffer.from(`${parts.join(':')}`));
}

export async function getUserIDFromFirebaseToken(req: Request ): Promise<string|null> {
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
  } else if(req.cookies) {
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
  return ['http://localhost:4200', 'https://quantified-self.io', 'https://beta.quantified-self.io'].indexOf(<string>req.get('origin')) !== -1
}

export async function setEvent(userID: string, eventID: string, event: EventInterface, metaData: MetaData) {
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
                        .set({
                            type: stream.type,
                            data: Buffer.from((Pako.gzip(JSON.stringify(stream.getData()), {to: 'string'})), 'binary'),
                        }))
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
    } catch (e) {
        console.error(e);
        debugger;
        return
        // Try to delete the parent entity and all subdata
        // await this.deleteAllEventData(user, event.getID());
    }
}

