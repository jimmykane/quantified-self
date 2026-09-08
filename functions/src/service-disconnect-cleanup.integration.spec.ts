import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { randomUUID } from 'crypto';
import { ACTIVITY_SYNC_ROUTES } from '../../shared/activity-sync-routes';
import { ROUTE_DELIVERY_SYNC_ROUTES } from '../../shared/route-delivery-sync-routes';

// Real Firestore transactions and recursiveDelete; only provider I/O is mocked.
// Run with npm run test:disconnect. Never use ADC or production Firestore.
vi.unmock('firebase-admin');
vi.unmock('@sports-alliance/sports-lib');
vi.unmock('./tokens');
vi.mock('./request-helper', () => ({ get: vi.fn(async () => ({})), post: vi.fn(async () => ({})), delete: vi.fn(async () => ({})) }));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

import * as providerRequests from './request-helper';
import * as connectionMeta from './service-connection-meta';
import { getTokenData } from './tokens';
import { deauthorizeServiceForUser, getServiceOAuth2CodeRedirectAndSaveStateToUser, retryInterruptedExplicitDisconnects } from './OAuth2';
import { getServiceTokenRootDocumentRef } from './service-token-store';
import { clearServiceDisconnectPending } from './service-disconnect-pending';
import { cleanupServiceDisconnectTasksForUser, processServiceDisconnectCleanup, retryServiceDisconnectCleanup, SERVICE_DISCONNECT_CLEANUP_COLLECTION } from './service-disconnect-cleanup';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
describe.skipIf(!emulatorHost)('explicit disconnect durability (Firestore emulator)', () => {
  let db: admin.firestore.Firestore;
  let uid: string;
  let providerID: string;
  const service = ServiceNames.SuuntoApp;
  const root = () => getServiceTokenRootDocumentRef(uid, service);
  const token = () => root().collection('tokens').doc(providerID);
  const settings = () => db.doc(`users/${uid}/config/settings`);
  const meta = () => db.doc(`users/${uid}/meta/${service}`);
  const tasks = () => db.collection(SERVICE_DISCONNECT_CLEANUP_COLLECTION).where('userID', '==', uid);
  const queue = () => db.collection('suuntoAppWorkoutQueue');

  beforeAll(() => {
    if (!emulatorHost || !/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost)) throw new Error('Loopback Firestore emulator required');
    admin.initializeApp({ projectId: 'demo-disconnect' });
    db = admin.firestore();
  });
  afterAll(async () => { await admin.app().delete(); });
  afterEach(() => { vi.restoreAllMocks(); });

  beforeEach(async () => {
    uid = `disconnect-test-${randomUUID()}`;
    providerID = `test-provider-${randomUUID()}`;
    const batch = db.batch();
    batch.set(db.doc(`users/${uid}`), { test: true });
    batch.set(root(), { activeOAuthCredentialGeneration: 'original-credential' });
    batch.set(token(), { serviceName: service, userName: providerID, accessToken: 'test-access', refreshToken: 'test-refresh', tokenCredentialGeneration: 'original-credential' });
    batch.set(meta(), { connectionStateGeneration: 'connected-generation' });
    batch.set(settings(), { unrelatedPreference: true, serviceSyncSettings: {
      activitySyncRoutes: Object.fromEntries(Object.keys(ACTIVITY_SYNC_ROUTES).map(id => [id, { enabled: true }])),
      routeDeliverySyncRoutes: Object.fromEntries(Object.keys(ROUTE_DELIVERY_SYNC_ROUTES).map(id => [id, { enabled: true }])),
      pendingDisconnectRouteRestore: { 'activity:SuuntoApp_to_WahooAPI': true, 'routeDelivery:SuuntoApp_to_WahooAPI': true },
    } });
    await batch.commit();
  });

  async function expectRoutesDisabled(provider = service): Promise<void> {
    const data = (await settings().get()).data()!;
    expect(data.unrelatedPreference).toBe(true);
    for (const [key, routes] of [['activitySyncRoutes', ACTIVITY_SYNC_ROUTES], ['routeDeliverySyncRoutes', ROUTE_DELIVERY_SYNC_ROUTES]] as const) {
      for (const route of Object.values(routes)) {
        const affected = route.sourceServiceName === provider || route.destinationServiceName === provider;
        expect(data.serviceSyncSettings[key][route.id].enabled).toBe(!affected);
      }
    }
    if (provider === service) expect(data.serviceSyncSettings.pendingDisconnectRouteRestore).toEqual({});
  }

  async function expireLease(): Promise<void> {
    await root().update({ disconnectOperationLeaseExpiresAt: Date.now() - 1 });
  }

  function failCredentialDelete(): void {
    const run = db.runTransaction.bind(db);
    vi.spyOn(db, 'runTransaction').mockImplementation(callback => run(async transaction => {
      const remove = transaction.delete.bind(transaction);
      transaction.delete = ref => {
        if (ref.path === token().path) throw new Error('interrupted after revocation');
        return remove(ref);
      };
      return callback(transaction);
    }));
  }

  it.each([ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.GarminAPI, ServiceNames.WahooAPI])(
    'atomically disables every affected direction before provider I/O: %s', async provider => {
      const providerRoot = getServiceTokenRootDocumentRef(uid, provider);
      await providerRoot.set({ activeOAuthCredentialGeneration: 'original-credential' });
      // Empty roots still need the explicit disable; do not rely on a delete trigger.
      if (provider !== service) await token().delete();
      vi.spyOn(providerRequests, 'get').mockImplementation(async () => { await expectRoutesDisabled(provider); return {}; });
      await deauthorizeServiceForUser(uid, provider, { missingTokensBehavior: 'ignore' });
      await expectRoutesDisabled(provider);
      expect((await providerRoot.get()).exists).toBe(false);
    },
  );

  it('recovers termination after provider revocation, before deleting credentials', async () => {
    failCredentialDelete();
    await expect(deauthorizeServiceForUser(uid, service)).rejects.toThrow();
    await expectRoutesDisabled();
    expect((await token().get()).exists).toBe(true);
    expect((await tasks().get()).empty).toBe(true); // aborted transaction leaves no partial intent
    const episode = (await root().get()).data()!.disconnectOperationGeneration;
    vi.restoreAllMocks();
    await expireLease();
    await retryInterruptedExplicitDisconnects();
    expect((await root().get()).exists).toBe(false);
    expect((await token().get()).exists).toBe(false);
    const task = (await tasks().get()).docs[0].data();
    expect(task.lifecycle.disconnectOperationGeneration).toBe(episode);
    expect(JSON.stringify(task)).not.toMatch(/test-access|test-refresh|accessToken|refreshToken|codeVerifier/);
  });

  it('finishes explicit recovery of a subscription-pending connection without enabling ordinary token use', async () => {
    await root().update({ disconnectState: 'disconnect_pending', disconnectGeneration: 'subscription-episode' });
    await expect(getTokenData(await token().get(), service)).rejects.toMatchObject({
      name: 'TokenUseSkippedForPendingDisconnectError',
    });
    failCredentialDelete();
    const revoke = vi.spyOn(providerRequests, 'get');
    await expect(deauthorizeServiceForUser(uid, service)).rejects.toThrow();
    expect(revoke).toHaveBeenCalled();
    vi.restoreAllMocks();
    await expireLease();
    await retryInterruptedExplicitDisconnects();
    expect((await root().get()).exists).toBe(false);
    expect((await token().get()).exists).toBe(false);
    expect((await tasks().get()).size).toBe(1);
    await expectRoutesDisabled();
  });

  it('keeps a retryable intent after token deletion and before metadata finalization', async () => {
    const oldWork = queue().doc(`old-${uid}`);
    await oldWork.set({ userName: providerID, firebaseUserID: uid });
    vi.spyOn(connectionMeta, 'clearServiceConnectionState').mockRejectedValueOnce(new Error('interrupted before finalization'));
    await expect(deauthorizeServiceForUser(uid, service)).rejects.toMatchObject({ name: 'ServiceDisconnectInProgressError' });
    expect((await token().get()).exists).toBe(false);
    expect((await root().get()).data()!.disconnectOperationGeneration).toEqual(expect.any(String));
    expect((await tasks().get()).size).toBe(1);
    expect((await oldWork.get()).exists).toBe(true); // callable never scans operational queues
    await expectRoutesDisabled();
    await expireLease();
    await retryInterruptedExplicitDisconnects();
    await retryServiceDisconnectCleanup();
    expect((await root().get()).exists).toBe(false);
    expect((await oldWork.get()).exists).toBe(false);
    expect((await tasks().get()).empty).toBe(true);
  });

  it('rolls back token removal when cleanup-intent persistence fails', async () => {
    const run = db.runTransaction.bind(db);
    vi.spyOn(db, 'runTransaction').mockImplementation(callback => run(async transaction => {
      const set = transaction.set.bind(transaction);
      transaction.set = ((ref: admin.firestore.DocumentReference, data: Record<string, unknown>, options?: admin.firestore.SetOptions) => {
        if (ref.parent.id === SERVICE_DISCONNECT_CLEANUP_COLLECTION) throw new Error('cleanup intent unavailable');
        return options ? set(ref, data, options) : set(ref, data);
      }) as typeof transaction.set;
      return callback(transaction);
    }));
    await expect(deauthorizeServiceForUser(uid, service)).rejects.toThrow();
    expect((await token().get()).exists).toBe(true);
    expect((await tasks().get()).empty).toBe(true);
    await expectRoutesDisabled();
  });

  it('pages operational cleanup, recursively deletes descendants, and resumes after failure', async () => {
    const batch = db.batch();
    for (let i = 0; i < 31; i++) batch.set(queue().doc(`${uid}-${i.toString().padStart(2, '0')}`), { userName: providerID, firebaseUserID: uid });
    const descendant = queue().doc(`${uid}-00`).collection('details').doc('nested');
    batch.set(descendant, { test: true });
    await batch.commit();
    await deauthorizeServiceForUser(uid, service);
    const taskRef = (await tasks().get()).docs[0].ref;
    const remove = vi.spyOn(db, 'recursiveDelete').mockRejectedValueOnce(new Error('storage-independent Firestore failure'));
    await processServiceDisconnectCleanup(taskRef);
    expect((await taskRef.get()).exists).toBe(true);
    await taskRef.update({ nextAttemptAt: 0 });
    await processServiceDisconnectCleanup(taskRef);
    expect(remove).toHaveBeenCalled();
    expect((await descendant.get()).exists).toBe(false);
    expect((await queue().where('userName', '==', providerID).get()).size).toBe(6);
    expect((await taskRef.get()).data()!.cursor).toBe(`${uid}-24`);
    await processServiceDisconnectCleanup(taskRef);
    expect((await queue().where('userName', '==', providerID).get()).empty).toBe(true);
    expect((await taskRef.get()).exists).toBe(false);
  }, 30_000);

  it('re-drives claimed work after worker termination and does not steal an active lease', async () => {
    await deauthorizeServiceForUser(uid, service);
    const taskRef = (await tasks().get()).docs[0].ref;
    await taskRef.update({ lease: 'lost-worker', nextAttemptAt: Date.now() + 60_000 });
    await processServiceDisconnectCleanup(taskRef);
    expect((await taskRef.get()).data()!.lease).toBe('lost-worker');
    await db.doc(`userDeletionTombstones/${uid}`).set({ requestedAt: Date.now() });
    await cleanupServiceDisconnectTasksForUser(uid);
    expect((await taskRef.get()).data()!.lease).toBe('lost-worker');
    await taskRef.update({ nextAttemptAt: 0 });
    await retryServiceDisconnectCleanup();
    expect((await taskRef.get()).exists).toBe(false);
  });

  it.each([false, true])('skips shared provider-only rows and other owners without blocking owned cleanup (deleting: %s)', async deleting => {
    const shared = queue().doc(`a-${uid}`);
    const other = queue().doc(`b-${uid}`);
    const owned = queue().doc(`c-${uid}`);
    await shared.set({ userName: providerID });
    await other.set({ userName: providerID, firebaseUserID: 'other-test-user' });
    await owned.set({ userName: providerID, firebaseUserID: uid });
    await getServiceTokenRootDocumentRef(`other-${uid}`, service).collection('tokens').doc(providerID)
      .set({ userName: providerID, serviceName: service });
    await deauthorizeServiceForUser(uid, service);
    const ref = (await tasks().get()).docs[0].ref;
    if (deleting) {
      await db.doc(`userDeletionTombstones/${uid}`).set({ requestedAt: Date.now() });
      await db.recursiveDelete(db.doc(`users/${uid}`));
    }
    await processServiceDisconnectCleanup(ref);
    expect((await shared.get()).exists).toBe(true);
    expect((await other.get()).exists).toBe(true);
    expect((await owned.get()).exists).toBe(false);
    expect((await ref.get()).exists).toBe(false);
  });

  it('retires stale work if a reconnect wins during the operational scan', async () => {
    const work = queue().doc(uid);
    await work.set({ userName: providerID, firebaseUserID: uid });
    await deauthorizeServiceForUser(uid, service);
    const ref = (await tasks().get()).docs[0].ref;
    const recursive = db.recursiveDelete.bind(db);
    vi.spyOn(db, 'recursiveDelete').mockImplementationOnce(async (target, writer) => {
      await root().set({ activeOAuthCredentialGeneration: 'replacement', oauthFlowGeneration: 'new-flow' });
      return recursive(target, writer);
    });
    await processServiceDisconnectCleanup(ref);
    expect((await work.get()).exists).toBe(true);
    expect((await ref.get()).exists).toBe(false);
    expect((await root().get()).data()!.activeOAuthCredentialGeneration).toBe('replacement');
  });

  it('does not revoke a replacement connection from a stale recovery snapshot', async () => {
    failCredentialDelete();
    await expect(deauthorizeServiceForUser(uid, service)).rejects.toThrow();
    const episode = (await root().get()).data()!.disconnectOperationGeneration;
    vi.restoreAllMocks();
    await expireLease();
    await getServiceOAuth2CodeRedirectAndSaveStateToUser(uid, service, 'https://example.com/callback');
    const revoke = vi.spyOn(providerRequests, 'get');
    await expect(deauthorizeServiceForUser(uid, service, { expectedOperationGeneration: episode })).rejects.toThrow();
    expect(revoke).not.toHaveBeenCalled();
    expect((await root().get()).data()!.disconnectOperationGeneration).toBeUndefined();
  });

  it('does not allow entitlement recovery to restore explicitly disabled routes', async () => {
    failCredentialDelete();
    await expect(deauthorizeServiceForUser(uid, service)).rejects.toThrow();
    vi.restoreAllMocks();
    await clearServiceDisconnectPending(uid, service);
    expect((await root().get()).data()!.disconnectOperationGeneration).toEqual(expect.any(String));
    expect((await meta().get()).data()!.connectionState).toBe('disconnect_pending');
    await expectRoutesDisabled();
  });

  it('rejects account deletion before intent creation and completes existing empty cleanup without writing user descendants', async () => {
    await db.doc(`userDeletionTombstones/${uid}`).set({ requestedAt: Date.now() });
    await expect(deauthorizeServiceForUser(uid, service)).rejects.toThrow();
    expect((await tasks().get()).empty).toBe(true);
    // Local emulator fixture only: then model deletion beginning after disconnect.
    await db.doc(`userDeletionTombstones/${uid}`).delete();
    await deauthorizeServiceForUser(uid, service);
    const ref = (await tasks().get()).docs[0].ref;
    await db.doc(`userDeletionTombstones/${uid}`).set({ requestedAt: Date.now() });
    await db.doc(`users/${uid}`).delete();
    await processServiceDisconnectCleanup(ref);
    expect((await ref.get()).exists).toBe(false);
    expect((await db.doc(`users/${uid}`).get()).exists).toBe(false);
  });

  it('preserves provider-only cleanup through recursive account deletion and a transient failure', async () => {
    const work = queue().doc(`deleted-account-${uid}`);
    const nested = work.collection('payload').doc('part');
    await work.set({ userName: providerID });
    await nested.set({ test: true });
    await deauthorizeServiceForUser(uid, service);
    const ref = (await tasks().get()).docs[0].ref;
    await db.doc(`userDeletionTombstones/${uid}`).set({ requestedAt: Date.now() });
    // Models Delete User Data winning the race with the separate Auth cleanup.
    await db.recursiveDelete(db.doc(`users/${uid}`));
    expect((await ref.get()).exists).toBe(true);
    vi.spyOn(db, 'recursiveDelete').mockRejectedValueOnce(new Error('retry cleanup'));
    await cleanupServiceDisconnectTasksForUser(uid);
    expect((await ref.get()).exists).toBe(true);
    expect((await work.get()).exists).toBe(true);
    await ref.update({ nextAttemptAt: 0 });
    await retryServiceDisconnectCleanup();
    expect((await nested.get()).exists).toBe(false);
    expect((await work.get()).exists).toBe(false);
    expect((await ref.get()).exists).toBe(false);
    expect((await db.doc(`users/${uid}`).get()).exists).toBe(false);
  });

  it('retains deleted-account cleanup until remaining credentials are removed', async () => {
    const work = queue().doc(`wait-for-credentials-${uid}`);
    await work.set({ userName: providerID });
    await deauthorizeServiceForUser(uid, service);
    const ref = (await tasks().get()).docs[0].ref;
    // A retained connection from another episode is now owned by account
    // deletion; the disconnect task must not skip its provider-only queues.
    await root().set({ activeOAuthCredentialGeneration: 'later-episode' });
    await token().set({ serviceName: service, userName: providerID });
    await db.doc(`userDeletionTombstones/${uid}`).set({ requestedAt: Date.now() });
    await cleanupServiceDisconnectTasksForUser(uid);
    expect((await ref.get()).data()!.nextAttemptAt).toBeGreaterThan(Date.now());
    expect((await work.get()).exists).toBe(true);
    await db.recursiveDelete(root());
    await ref.update({ nextAttemptAt: 0 });
    await cleanupServiceDisconnectTasksForUser(uid);
    expect((await work.get()).exists).toBe(false);
    expect((await ref.get()).exists).toBe(false);
  });

  it('continues cleanup if account deletion begins after a worker claimed it', async () => {
    const work = queue().doc(`deletion-race-${uid}`);
    await work.set({ userName: providerID, firebaseUserID: uid });
    await deauthorizeServiceForUser(uid, service);
    const ref = (await tasks().get()).docs[0].ref;
    const recursive = db.recursiveDelete.bind(db);
    vi.spyOn(db, 'recursiveDelete').mockImplementationOnce(async (target, writer) => {
      await db.doc(`userDeletionTombstones/${uid}`).set({ requestedAt: Date.now() });
      await recursive(db.doc(`users/${uid}`));
      return recursive(target, writer);
    });
    await processServiceDisconnectCleanup(ref);
    expect((await work.get()).exists).toBe(false);
    expect((await ref.get()).exists).toBe(false);
    expect((await db.doc(`users/${uid}`).get()).exists).toBe(false);
  });

  it('preserves operational rows created after the credential-removal cutoff', async () => {
    await deauthorizeServiceForUser(uid, service);
    const ref = (await tasks().get()).docs[0].ref;
    await ref.update({ cutoffAt: Timestamp.fromMillis(1) });
    const newer = queue().doc(uid);
    await newer.set({ userName: providerID, firebaseUserID: uid });
    await processServiceDisconnectCleanup(ref);
    expect((await newer.get()).exists).toBe(true);
    expect((await ref.get()).exists).toBe(false);
  });

  it('advances recovery past an interrupted root belonging to a deleted user', async () => {
    failCredentialDelete();
    await expect(deauthorizeServiceForUser(uid, service)).rejects.toThrow();
    vi.restoreAllMocks();
    await root().update({ disconnectOperationLeaseExpiresAt: 2 });
    const deletedRoot = getServiceTokenRootDocumentRef(`deleted-${uid}`, service);
    await deletedRoot.set({ disconnectOperationGeneration: 'old-deleted-operation', disconnectOperationLeaseExpiresAt: 1 });
    await retryInterruptedExplicitDisconnects();
    await retryInterruptedExplicitDisconnects();
    expect((await root().get()).exists).toBe(false);
    expect((await deletedRoot.get()).exists).toBe(true); // account cleanup owns this root
  });
});
