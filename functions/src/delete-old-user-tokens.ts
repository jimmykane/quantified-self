import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { deauthorizeServiceForUser } from './OAuth2';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';
import { UserRecord } from 'firebase-admin/auth';


export const deleteOldUserTokens = functions.region('europe-west2').runWith({ timeoutSeconds: 540 }).pubsub.schedule('every 6 months').onRun(async (context) => {
  let pageToken = true;
  while (pageToken) {
    const result: any = await admin.auth().listUsers(1000, pageToken === true ? undefined : pageToken);
    pageToken = result.pageToken;
    console.log(`Page token is ${pageToken}`);
    const oldUsers = result.users.filter((u: UserRecord) => new Date(u.metadata.lastSignInTime).getTime() + (361 * 24 * 60 * 60 * 1000) < new Date().getTime());
    console.log(`Found ${oldUsers.length} old users`);
    for (const user of oldUsers) {
      console.log(`Found user with id ${user.uid} for deauthorization and last login ${user.metadata.lastSignInTime}`);
      for (const serviceName in ServiceNames) {
        try {
          await deauthorizeServiceForUser(user.uid, ServiceNames[serviceName as keyof typeof ServiceNames]);
          console.log(`Deauthorized ${serviceName}`);
        } catch (e: any) {
          console.error(`Could not deauthorize ${serviceName}`);
        }
      }
      console.log(`Finished deauthorization for user with user id ${user.uid}`);
    }
  }
  console.log('Finished all');
});
