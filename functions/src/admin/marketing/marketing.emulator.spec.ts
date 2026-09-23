import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { handleMarketingUnsubscribe } from './handlers';
import { cleanupMarketingCampaignRecipients } from './cleanup';
import { completeCampaignIfDrained, dispatchCampaigns, makeUnsubscribeToken, optOut, prepareCampaign, recordMailDelivery, reserveMail, saveCampaign, sendTest, setCampaignStatus, verifyUnsubscribeToken } from './service';
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

  it('charges test sends to the same daily limit', async () => {
    const user = await admin.auth().createUser({ email: `test-admin-${randomUUID()}@example.com` });
    const campaign = await saveCampaign(null, draft, user.uid);
    await db.collection('marketingCampaigns').doc(campaign.id).update({ status: 'ready' });
    await db.doc('marketingControl/global').set({ dailyCap: 1 });
    await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).set({ used: 0 });
    const test = await sendTest(campaign.id, user.uid, secret);
    expect(test.submitted).toBe(true);
    const mail = await db.collection('mail').doc(test.mailId).get();
    expect(mail.get('to')).toBe(user.email);
    expect(mail.get('from')).toBe('Dimitrios from Quantified Self <updates@quantified-self.io>');
    expect((await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).get()).get('used')).toBe(1);
    await expect(sendTest(campaign.id, user.uid, secret)).rejects.toThrow();
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
});
