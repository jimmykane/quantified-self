import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { handleMarketingUnsubscribe } from './handlers';
import { cleanupMarketingCampaignRecipients } from './cleanup';
import { completeCampaignIfDrained, dispatchCampaigns, listCampaigns, makeUnsubscribeToken, optOut, prepareCampaign, recordMailDelivery, reserveMail, saveCampaign, sendTest, setCampaignStatus, verifyUnsubscribeToken } from './service';
import { utcDay } from './core';

vi.unmock('firebase-admin');
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
const enabled = !!process.env.FIRESTORE_EMULATOR_HOST && !!process.env.FIREBASE_AUTH_EMULATOR_HOST;
const secret = 'local-marketing-unsubscribe-signing-key-for-tests';
const draft = {
  name: 'Emulator campaign', subject: 'A real preview',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello test.' }] }] },
  cta: null,
  filters: { plans: ['free'], signupFrom: null, signupTo: null },
};

describe.skipIf(!enabled)('marketing campaign durability (emulators)', () => {
  let db: admin.firestore.Firestore;
  beforeAll(() => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
        !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) throw new Error('Loopback emulators required');
    admin.initializeApp({ projectId: 'demo-marketing' });
    db = admin.firestore();
  });
  afterAll(async () => { await admin.app().delete(); });

  it('freezes consent-only recipients and rechecks opt-outs before submission', async () => {
    const prefix = randomUUID().slice(0, 8);
    const included = await admin.auth().createUser({ email: `${prefix}-included@example.com`, emailVerified: false });
    const optedOut = await admin.auth().createUser({ email: `${prefix}-optout@example.com`, emailVerified: false });
    const late = await admin.auth().createUser({ email: `${prefix}-late@example.com`, emailVerified: false });
    const adminUser = await admin.auth().createUser({ email: `${prefix}-admin@example.com`, emailVerified: false });
    await admin.auth().setCustomUserClaims(adminUser.uid, { admin: true });
    const batch = db.batch();
    for (const user of [included, optedOut, late, adminUser]) batch.set(db.doc(`users/${user.uid}`), { test: true });
    for (const user of [included, optedOut, adminUser]) batch.set(db.doc(`users/${user.uid}/legal/agreements`), { acceptedMarketingPolicy: true });
    await batch.commit();
    const created = await saveCampaign(null, draft, adminUser.uid);
    const prepared = await prepareCampaign(created.id);
    expect(prepared.stats.eligible).toBe(2);
    expect(prepared.exclusions.disabledOrAdmin).toBe(1);
    await db.doc(`users/${late.uid}/legal/agreements`).set({ acceptedMarketingPolicy: true });
    expect((await db.doc(`marketingCampaigns/${created.id}/recipients/${late.uid}`).get()).exists).toBe(false);
    await optOut(optedOut.uid);
    expect(verifyUnsubscribeToken(makeUnsubscribeToken(optedOut.uid, secret), secret)).toBe(optedOut.uid);

    // A successfully accepted test is required before starting. The extension is
    // absent in this emulator test, so write its result directly to a test mail.
    const testId = `marketing_test_${created.id}_emulator`;
    await db.collection('mail').doc(testId).set({ delivery: { state: 'SUCCESS' } });
    await db.collection('marketingCampaigns').doc(created.id).update({ lastTestMailId: testId });
    await setCampaignStatus(created.id, 'start');
    await db.doc('marketingControl/global').set({ dailyCap: 1 });
    await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).set({ used: 0 });
    await Promise.all([dispatchCampaigns(secret), dispatchCampaigns(secret)]);
    const recipientA = await db.doc(`marketingCampaigns/${created.id}/recipients/${included.uid}`).get();
    expect(recipientA.get('status')).toBe('queued');
    await db.doc('marketingControl/global').update({ dailyCap: 2 });
    await dispatchCampaigns(secret);
    const recipientB = await db.doc(`marketingCampaigns/${created.id}/recipients/${optedOut.uid}`).get();
    expect(recipientB.get('status')).toBe('skipped');
    expect((await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).get()).get('used')).toBe(1);
    const mailId = recipientA.get('mailId');
    const mail = await db.collection('mail').doc(mailId).get();
    expect(mail.get('to')).toBe(included.email);
    expect(mail.get('headers.List-Unsubscribe-Post')).toBe('List-Unsubscribe=One-Click');
    expect(mail.get('message.html')).toContain('Unsubscribe');
    await recordMailDelivery(mailId, { ...mail.data(), delivery: { state: 'PENDING' } }, { ...mail.data(), delivery: { state: 'SUCCESS' } });
    await recordMailDelivery(mailId, { ...mail.data(), delivery: { state: 'PENDING' } }, { ...mail.data(), delivery: { state: 'SUCCESS' } });
    const final = (await db.collection('marketingCampaigns').doc(created.id).get()).data()!;
    expect(final.stats).toMatchObject({ eligible: 2, pending: 0, queued: 0, accepted: 1, skipped: 1 });
  });

  it('recovers a timed-out audience preparation and replaces its partial snapshot', async () => {
    const campaign = await saveCampaign(null, draft, 'admin');
    const ref = db.collection('marketingCampaigns').doc(campaign.id);
    await ref.update({ status: 'preparing', snapshotId: 'abandoned',
      updatedAt: new Date(Date.now() - 12 * 60_000).toISOString() });
    await ref.collection('recipients').doc('partial').set({ uid: 'partial', snapshotId: 'abandoned', status: 'pending' });

    const prepared = await prepareCampaign(campaign.id);
    expect(prepared.status).toBe('ready');
    expect((await ref.get()).get('snapshotId')).not.toBe('abandoned');
    expect((await ref.collection('recipients').doc('partial').get()).exists).toBe(false);

    const fresh = await saveCampaign(null, draft, 'admin');
    await db.collection('marketingCampaigns').doc(fresh.id).update({ status: 'preparing', updatedAt: new Date().toISOString() });
    await expect(prepareCampaign(fresh.id)).rejects.toThrow('already in progress');
  });

  it('shows confirmation on GET, changes consent only on POST, and allows repeated POST', async () => {
    const uid = `unsubscribe_${randomUUID().replace(/-/g, '')}`;
    const ref = db.doc(`users/${uid}/legal/agreements`);
    await ref.set({ acceptedMarketingPolicy: true });
    const token = makeUnsubscribeToken(uid, secret);
    const response = () => {
      const result = { code: 200, body: '', headers: {} as Record<string, string>,
        set(key: string, value: string) { this.headers[key] = value; return this; },
        type() { return this; },
        status(code: number) { this.code = code; return this; },
        send(body: string) { this.body = body; return this; },
      };
      return result;
    };
    const get = response();
    await handleMarketingUnsubscribe({ method: 'GET', query: { token } } as unknown as Request, get as unknown as Response, secret);
    expect(get.code).toBe(200);
    expect(get.body).toContain('<form method="post"');
    expect((await ref.get()).get('acceptedMarketingPolicy')).toBe(true);
    const post = response();
    await handleMarketingUnsubscribe({ method: 'POST', query: { token } } as unknown as Request, post as unknown as Response, secret);
    expect(post.code).toBe(200);
    expect(post.body).toContain('You are unsubscribed');
    expect((await ref.get()).get('acceptedMarketingPolicy')).toBe(false);
    await handleMarketingUnsubscribe({ method: 'POST', query: { token } } as unknown as Request, response() as unknown as Response, secret);
    await ref.update({ acceptedMarketingPolicy: true });
    const testGet = response();
    await handleMarketingUnsubscribe({ method: 'GET', query: { test: '1' } } as unknown as Request, testGet as unknown as Response, secret);
    expect(testGet.code).toBe(200);
    expect(testGet.body).toContain('No marketing preference was changed');
    expect(testGet.body).not.toContain('<form');
    const testPost = response();
    await handleMarketingUnsubscribe({ method: 'POST', query: { test: '1' } } as unknown as Request, testPost as unknown as Response, secret);
    expect(testPost.code).toBe(200);
    expect((await ref.get()).get('acceptedMarketingPolicy')).toBe(true);
    const invalid = response();
    await handleMarketingUnsubscribe({ method: 'GET', query: { token: 'invalid' } } as unknown as Request, invalid as unknown as Response, secret);
    expect(invalid.code).toBe(400);
  });

  it('requires an accepted test and supports pause, resume and explicit retry', async () => {
    const campaign = await saveCampaign(null, draft, 'admin');
    const ref = db.collection('marketingCampaigns').doc(campaign.id);
    await ref.update({ status: 'ready' });
    await expect(setCampaignStatus(campaign.id, 'start')).rejects.toThrow();
    const testId = `marketing_test_${campaign.id}_emulator`;
    await db.collection('mail').doc(testId).set({ delivery: { state: 'PENDING' } });
    await ref.update({ lastTestMailId: testId });
    await expect(setCampaignStatus(campaign.id, 'start')).rejects.toThrow();
    await db.collection('mail').doc(testId).update({ 'delivery.state': 'SUCCESS' });
    expect((await setCampaignStatus(campaign.id, 'start')).status).toBe('running');
    expect((await setCampaignStatus(campaign.id, 'pause')).status).toBe('paused');
    expect((await setCampaignStatus(campaign.id, 'resume')).status).toBe('running');
    await setCampaignStatus(campaign.id, 'pause');
    const retryUser = await admin.auth().createUser({ email: `retry-${randomUUID()}@example.com`, emailVerified: false });
    await db.doc(`users/${retryUser.uid}`).set({ test: true });
    await db.doc(`users/${retryUser.uid}/legal/agreements`).set({ acceptedMarketingPolicy: true });
    const recipient = ref.collection('recipients').doc(retryUser.uid);
    await recipient.set({ uid: retryUser.uid, status: 'failed', attempt: 1 });
    await ref.update({ stats: { eligible: 1, pending: 0, queued: 0, accepted: 0, failed: 1, skipped: 0 } });
    expect((await setCampaignStatus(campaign.id, 'retry')).stats).toMatchObject({ pending: 1, failed: 0 });
    expect((await recipient.get()).get('attempt')).toBe(1);
    await db.doc('marketingControl/global').set({ dailyCap: 3 });
    await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).set({ used: 0 });
    await setCampaignStatus(campaign.id, 'resume');
    await dispatchCampaigns(secret);
    expect((await recipient.get()).get('mailId')).toBe(`marketing_${campaign.id}_${retryUser.uid}_2`);
    expect((await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).get()).get('used')).toBe(1);
  });

  it('does not complete a campaign after it is paused or gains pending work', async () => {
    const campaign = await saveCampaign(null, draft, 'admin');
    const ref = db.collection('marketingCampaigns').doc(campaign.id);
    await ref.update({ status: 'paused', stats: { eligible: 0, pending: 0, queued: 0, accepted: 0, failed: 0, skipped: 0 } });
    await completeCampaignIfDrained(ref);
    expect((await ref.get()).get('status')).toBe('paused');

    await ref.update({ status: 'running', stats: { eligible: 1, pending: 1, queued: 0, accepted: 0, failed: 0, skipped: 0 } });
    await completeCampaignIfDrained(ref);
    expect((await ref.get()).get('status')).toBe('running');

    await ref.update({ stats: { eligible: 1, pending: 0, queued: 0, accepted: 1, failed: 0, skipped: 0 } });
    await completeCampaignIfDrained(ref);
    expect((await ref.get()).get('status')).toBe('completed');
  });

  it('does not pause a resumed campaign while an earlier retry request finishes', async () => {
    const campaign = await saveCampaign(null, draft, 'admin');
    const ref = db.collection('marketingCampaigns').doc(campaign.id);
    await ref.update({ status: 'paused', stats: { eligible: 2, pending: 0, queued: 0, accepted: 0, failed: 2, skipped: 0 } });
    for (const uid of ['first', 'second']) {
      await ref.collection('recipients').doc(uid).set({ uid, status: 'failed', attempt: 1 });
    }
    const originalTransaction = db.runTransaction.bind(db);
    let secondStarted!: () => void;
    let releaseSecond!: () => void;
    const started = new Promise<void>(resolve => { secondStarted = resolve; });
    const released = new Promise<void>(resolve => { releaseSecond = resolve; });
    let calls = 0;
    const transaction = vi.spyOn(db, 'runTransaction').mockImplementation(async (updateFunction, options) => {
      calls++;
      if (calls === 2) { secondStarted(); await released; }
      return originalTransaction(updateFunction, options);
    });
    try {
      const retry = setCampaignStatus(campaign.id, 'retry');
      await started;
      await setCampaignStatus(campaign.id, 'resume');
      releaseSecond();
      expect((await retry).status).toBe('running');
      expect((await ref.get()).get('stats')).toMatchObject({ pending: 1, failed: 1 });
    } finally {
      releaseSecond();
      transaction.mockRestore();
    }
  });

  it('removes account-deletion snapshots and skips work that was not accepted', async () => {
    const uid = `delete_${randomUUID().replace(/-/g, '')}`;
    const campaign = await saveCampaign(null, draft, 'admin');
    const ref = db.collection('marketingCampaigns').doc(campaign.id);
    await ref.update({ stats: { eligible: 1, pending: 0, queued: 0, accepted: 0, failed: 1, skipped: 0 } });
    const recipient = ref.collection('recipients').doc(uid);
    await recipient.set({ uid, status: 'failed', attempt: 1 });
    expect(await cleanupMarketingCampaignRecipients(db, uid)).toBe(1);
    expect((await recipient.get()).exists).toBe(false);
    expect((await ref.get()).get('stats')).toMatchObject({ eligible: 1, failed: 0, skipped: 1 });
  });

  it('sends saved drafts to a chosen address, invalidates tests after edits, and charges the daily limit', async () => {
    const user = await admin.auth().createUser({ email: `test-admin-${randomUUID()}@example.com` });
    const campaign = await saveCampaign(null, draft, user.uid);
    await db.doc('marketingControl/global').set({ dailyCap: 1 });
    await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).set({ used: 0 });
    const target = `preview-${randomUUID()}@example.org`;
    const test = await sendTest(campaign.id, user.uid, secret, target);
    expect(test.submitted).toBe(true);
    const mail = await db.collection('mail').doc(test.mailId).get();
    expect(mail.get('to')).toBe(target);
    expect(mail.get('message.subject')).toBe(`[TEST] ${draft.subject}`);
    expect(mail.get('headers.List-Unsubscribe')).toBe('<https://quantified-self.io/email/unsubscribe?test=1>');
    expect(mail.get('from')).toBe('Dimitrios from Quantified Self <updates@quantified-self.io>');
    expect((await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).get()).get('used')).toBe(1);
    await expect(sendTest(campaign.id, user.uid, secret, target)).rejects.toThrow();
    const edited = await saveCampaign(campaign.id, { ...draft, subject: 'Edited subject' }, user.uid);
    expect(edited.lastTestMailId).toBeNull();
  });

  it('sends an unsaved test without writing a campaign and still enforces the shared cap', async () => {
    const user = await admin.auth().createUser({ email: `unsaved-admin-${randomUUID()}@example.com` });
    await db.doc('marketingControl/global').set({ dailyCap: 1 });
    await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).set({ used: 0 });
    const campaignsBefore = (await db.collection('marketingCampaigns').get()).size;
    const target = `unsaved-${randomUUID()}@example.org`;
    const result = await sendTest(null, user.uid, secret, target, draft);
    const mail = await db.collection('mail').doc(result.mailId).get();
    expect(mail.get('to')).toBe(target);
    expect(mail.get('message.subject')).toBe(`[TEST] ${draft.subject}`);
    expect(mail.get('marketing.campaignId')).toBeNull();
    expect(mail.get('marketing.testCampaignId')).toBeUndefined();
    expect((await db.collection('marketingCampaigns').get()).size).toBe(campaignsBefore);
    expect((await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).get()).get('used')).toBe(1);
    await expect(sendTest(null, user.uid, secret, target, draft)).rejects.toThrow('limit');
  });

  it('does not submit a test when the campaign starts while the admin lookup is in flight', async () => {
    const user = await admin.auth().createUser({ email: `racing-admin-${randomUUID()}@example.com` });
    const campaign = await saveCampaign(null, draft, user.uid);
    const ref = db.collection('marketingCampaigns').doc(campaign.id);
    const acceptedTestId = `marketing_test_${campaign.id}_accepted`;
    await db.collection('mail').doc(acceptedTestId).set({ delivery: { state: 'SUCCESS' } });
    await ref.update({ status: 'ready', lastTestMailId: acceptedTestId });
    await db.doc('marketingControl/global').set({ dailyCap: 10 });
    await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).set({ used: 0 });

    const auth = admin.auth();
    const originalGetUser = auth.getUser.bind(auth);
    let lookupStarted!: () => void;
    let releaseLookup!: () => void;
    const started = new Promise<void>(resolve => { lookupStarted = resolve; });
    const released = new Promise<void>(resolve => { releaseLookup = resolve; });
    const lookup = vi.spyOn(auth, 'getUser').mockImplementation(async uid => {
      if (uid === user.uid) { lookupStarted(); await released; }
      return originalGetUser(uid);
    });
    try {
      const pendingTest = sendTest(campaign.id, user.uid, secret, user.email);
      await started;
      await setCampaignStatus(campaign.id, 'start');
      releaseLookup();
      await expect(pendingTest).rejects.toThrow('changed');
      expect((await ref.get()).get('lastTestMailId')).toBe(acceptedTestId);
      expect((await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).get()).get('used')).toBe(0);
    } finally {
      releaseLookup();
      lookup.mockRestore();
    }
  });

  it('skips a recipient whose plan changes after the snapshot', async () => {
    const user = await admin.auth().createUser({ email: `plan-${randomUUID()}@example.com`, emailVerified: false });
    await db.doc(`users/${user.uid}`).set({ test: true });
    await db.doc(`users/${user.uid}/legal/agreements`).set({ acceptedMarketingPolicy: true });
    const campaign = await saveCampaign(null, draft, 'admin');
    const campaignRef = db.collection('marketingCampaigns').doc(campaign.id);
    await campaignRef.update({ status: 'running', stats: { eligible: 1, pending: 1, queued: 0, accepted: 0, failed: 0, skipped: 0 } });
    await campaignRef.collection('recipients').doc(user.uid).set({ uid: user.uid, status: 'pending', attempt: 0 });
    await db.doc(`customers/${user.uid}/subscriptions/paid`).set({ status: 'active', role: 'pro', created: 100 });
    await db.doc('marketingControl/global').set({ dailyCap: 10 });
    await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).set({ used: 0 });
    await dispatchCampaigns(secret);
    expect((await campaignRef.collection('recipients').doc(user.uid).get()).get('status')).toBe('skipped');
    expect((await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).get()).get('used')).toBe(0);
  });

  it('starts a fresh UTC counter at midnight', async () => {
    await db.doc('marketingControl/global').set({ dailyCap: 1 });
    await db.doc('marketingDispatchDays/2026-09-23').set({ used: 0 });
    await db.doc('marketingDispatchDays/2026-09-24').set({ used: 0 });
    const mail = { to: 'test@example.com', message: { subject: 'test', text: 'test' } };
    expect(await reserveMail(randomUUID(), mail,
      () => new Date('2026-09-23T23:59:59.999Z'))).toBe(true);
    expect(await reserveMail(randomUUID(), mail,
      () => new Date('2026-09-24T00:00:00.000Z'))).toBe(true);
    expect((await db.doc('marketingDispatchDays/2026-09-23').get()).get('used')).toBe(1);
    expect((await db.doc('marketingDispatchDays/2026-09-24').get()).get('used')).toBe(1);
  });

  it('reserves a global slot atomically and applies cap changes without resetting usage', async () => {
    const day = utcDay(new Date());
    await db.doc('marketingControl/global').set({ dailyCap: 1 });
    await db.doc(`marketingDispatchDays/${day}`).set({ used: 0 });
    const ids = [randomUUID(), randomUUID()];
    const results = await Promise.all(ids.map(id => reserveMail(id, { to: 'test@example.com', message: { subject: 'test', text: 'test' } })));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await db.doc(`marketingDispatchDays/${day}`).get()).get('used')).toBe(1);
    await db.doc('marketingControl/global').update({ dailyCap: 2 });
    expect(await reserveMail(randomUUID(), { to: 'test@example.com', message: { subject: 'test', text: 'test' } })).toBe(true);
    expect((await db.doc(`marketingDispatchDays/${day}`).get()).get('used')).toBe(2);
  });

  it('keeps the oldest campaign first after a full page of skipped recipients', async () => {
    const user = await admin.auth().createUser({ uid: `valid_${randomUUID()}`, email: `oldest-${randomUUID()}@example.com`, emailVerified: false });
    const newerUser = await admin.auth().createUser({ uid: `newer_${randomUUID()}`, email: `newer-${randomUUID()}@example.com`, emailVerified: false });
    for (const recipient of [user, newerUser]) {
      await db.doc(`users/${recipient.uid}`).set({ test: true });
      await db.doc(`users/${recipient.uid}/legal/agreements`).set({ acceptedMarketingPolicy: true });
    }
    const older = await saveCampaign(null, draft, 'admin');
    const newer = await saveCampaign(null, draft, 'admin');
    const olderRef = db.collection('marketingCampaigns').doc(older.id);
    const newerRef = db.collection('marketingCampaigns').doc(newer.id);
    await olderRef.update({ status: 'running', createdAt: '1990-01-01T00:00:00.000Z',
      stats: { eligible: 23, pending: 23, queued: 0, accepted: 0, failed: 0, skipped: 0 } });
    await newerRef.update({ status: 'running', createdAt: '2099-01-01T00:00:00.000Z',
      stats: { eligible: 1, pending: 1, queued: 0, accepted: 0, failed: 0, skipped: 0 } });
    const batch = db.batch();
    for (let index = 0; index < 22; index++) {
      const uid = `missing_${String(index).padStart(2, '0')}`;
      batch.set(olderRef.collection('recipients').doc(uid), { uid, status: 'pending', attempt: 0 });
    }
    batch.set(olderRef.collection('recipients').doc(user.uid), { uid: user.uid, status: 'pending', attempt: 0 });
    batch.set(newerRef.collection('recipients').doc(newerUser.uid), { uid: newerUser.uid, status: 'pending', attempt: 0 });
    await batch.commit();
    await db.doc('marketingControl/global').set({ dailyCap: 1 });
    await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).set({ used: 0 });

    expect(await dispatchCampaigns(secret)).toBe(1);
    expect((await olderRef.collection('recipients').doc(user.uid).get()).get('status')).toBe('queued');
    expect((await newerRef.collection('recipients').doc(newerUser.uid).get()).get('status')).toBe('pending');
  });

  it('dispatches campaigns beyond the first page of running campaigns', async () => {
    // Earlier cases leave independent running fixtures in this shared emulator.
    // Pause them so this pagination check has an isolated dispatch queue.
    const previousRunning = await db.collection('marketingCampaigns').where('status', '==', 'running').get();
    const pause = db.batch();
    for (const campaign of previousRunning.docs) pause.update(campaign.ref, { status: 'paused' });
    await pause.commit();
    const user = await admin.auth().createUser({ email: `paged-${randomUUID()}@example.com`, emailVerified: false });
    await db.doc(`users/${user.uid}`).set({ test: true });
    await db.doc(`users/${user.uid}/legal/agreements`).set({ acceptedMarketingPolicy: true });
    const blockerStats = { eligible: 1, pending: 0, queued: 1, accepted: 0, failed: 0, skipped: 0 };
    const batch = db.batch();
    let oldestCampaignId = '';
    for (let index = 0; index < 100; index++) {
      const ref = db.collection('marketingCampaigns').doc();
      if (index === 0) oldestCampaignId = ref.id;
      batch.set(ref, { ...draft, status: 'running', stats: blockerStats,
        createdAt: new Date(Date.UTC(2000, 0, 1, 0, index)).toISOString() });
    }
    await batch.commit();
    const target = await saveCampaign(null, draft, 'admin');
    const targetRef = db.collection('marketingCampaigns').doc(target.id);
    await targetRef.update({ status: 'running', createdAt: '2099-01-01T00:00:00.000Z',
      stats: { eligible: 1, pending: 1, queued: 0, accepted: 0, failed: 0, skipped: 0 } });
    await targetRef.collection('recipients').doc(user.uid).set({ uid: user.uid, status: 'pending', attempt: 0 });
    await db.doc('marketingControl/global').set({ dailyCap: 1 });
    await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).set({ used: 0 });

    expect(await dispatchCampaigns(secret)).toBe(1);
    expect((await targetRef.collection('recipients').doc(user.uid).get()).get('status')).toBe('queued');
    expect((await listCampaigns()).campaigns.some(item => item.id === oldestCampaignId)).toBe(true);
  });
});
