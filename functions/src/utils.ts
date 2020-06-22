import * as base58 from 'bs58';
import { Request } from 'firebase-functions';
import * as admin from "firebase-admin";


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
    console.log('ID Token correctly decoded', decodedIdToken);

    return decodedIdToken.uid;
  } catch (error) {
    console.error('Error while verifying Firebase ID token:', error);
    return null;
  }
}
