import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { JSDOM } from 'jsdom';
import { handleMarketingUnsubscribe } from './handlers';
import { cleanupMarketingCampaignRecipients } from './cleanup';
import { cloneCampaign, completeCampaignIfDrained, dispatchCampaigns, listCampaigns, makeUnsubscribeToken, optOut, prepareCampaign, recordMailDelivery, reserveMail, saveCampaign, sendTest, setCampaignStatus, verifyUnsubscribeToken } from './service';
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

  async function isolateWorker(): Promise<void> {
    const running = await db.collection('marketingCampaigns').where('status', '==', 'running').get();
    const batch = db.batch();
    for (const doc of running.docs) batch.update(doc.ref, { status: 'paused' });
    await batch.commit();
  }
  async function readyScheduledCampaign(count: number, schedule: { time: string; timeZone: string } | null) {
    const campaign = await saveCampaign(null, { ...draft, schedule }, 'admin');
    const ref = db.collection('marketingCampaigns').doc(campaign.id);
    const users = await Promise.all(Array.from({ length: count }, () =>
      admin.auth().createUser({ email: `schedule-${randomUUID()}@example.com`, emailVerified: false })));
    const batch = db.batch();
    for (const user of users) {
      batch.set(db.doc(`users/${user.uid}`), { test: true });
      batch.set(db.doc(`users/${user.uid}/legal/agreements`), { acceptedMarketingPolicy: true });
      batch.set(ref.collection('recipients').doc(user.uid), { uid: user.uid, status: 'pending', attempt: 0 });
    }
    const testId = `marketing_test_${campaign.id}_accepted`;
    batch.set(db.collection('mail').doc(testId), { delivery: { state: 'SUCCESS' } });
    batch.update(ref, { status: 'ready', lastTestMailId: testId,
      stats: { eligible: count, pending: count, queued: 0, accepted: 0, failed: 0, skipped: 0 } });
    await batch.commit();
    return { campaign, ref, users, testId };
  }

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
    const testId = `marketing_test_${campaign.id}_emulator`;
    await db.collection('mail').doc(testId).set({ delivery: { state: 'SUCCESS' } });
    await ref.update({ status: 'paused', lastTestMailId: testId,
      stats: { eligible: 2, pending: 0, queued: 0, accepted: 0, failed: 2, skipped: 0 } });
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

  it('edits paused content while preserving the audience, queued mail, and progress, and requires a fresh accepted test', async () => {
    const user = await admin.auth().createUser({ email: `paused-admin-${randomUUID()}@example.com` });
    const campaign = await saveCampaign(null, draft, user.uid);
    const ref = db.collection('marketingCampaigns').doc(campaign.id);
    const recipient = ref.collection('recipients').doc('already-queued');
    const mail = db.collection('mail').doc(`marketing_${campaign.id}_already-queued_1`);
    const stats = { eligible: 5, pending: 1, queued: 1, accepted: 1, failed: 1, skipped: 1 };
    const startedAt = '2026-09-20T12:00:00.000Z';
    await recipient.set({ uid: recipient.id, status: 'queued', mailId: mail.id, attempt: 1 });
    await mail.set({ message: { subject: draft.subject, html: '<p>Original queued message</p>' }, delivery: { state: 'PENDING' } });
    await ref.update({ status: 'paused', stats, startedAt, snapshotId: 'fixed-snapshot', lastTestMailId: 'previous-test', lastTestState: 'SUCCESS' });
    const editedDraft = { ...draft, name: 'Updated campaign', subject: 'Updated subject',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated message.' }] }] },
      cta: { label: 'Read more', url: 'https://quantified-self.io/help' } };

    for (const filters of [
      { ...draft.filters, plans: ['pro'] },
      { ...draft.filters, signupFrom: '2026-09-01' },
      { ...draft.filters, signupTo: '2026-09-30' },
    ]) {
      await expect(saveCampaign(campaign.id, { ...editedDraft, filters }, user.uid)).rejects.toThrow('audience is fixed');
    }
    const edited = await saveCampaign(campaign.id, editedDraft, user.uid);
    expect(edited).toMatchObject({ ...editedDraft, status: 'paused', stats, startedAt,
      exclusions: campaign.exclusions, createdAt: campaign.createdAt, lastTestMailId: null, lastTestState: null });
    expect((await ref.get()).get('snapshotId')).toBe('fixed-snapshot');
    expect((await recipient.get()).data()).toMatchObject({ status: 'queued', mailId: mail.id, attempt: 1 });
    expect((await mail.get()).get('message.subject')).toBe(draft.subject);
    expect((await mail.get()).get('message.html')).toBe('<p>Original queued message</p>');
    await expect(setCampaignStatus(campaign.id, 'resume')).rejects.toThrow('Send a test email');

    await db.doc('marketingControl/global').set({ dailyCap: 2 });
    await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).set({ used: 0 });
    const test = await sendTest(campaign.id, user.uid, secret, 'preview@example.org');
    const testRef = db.collection('mail').doc(test.mailId);
    expect((await testRef.get()).get('message.html')).toContain('Updated message.');
    expect((await testRef.get()).get('message.text')).toContain('Read more: https://quantified-self.io/help');
    expect((await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).get()).get('used')).toBe(1);
    await expect(setCampaignStatus(campaign.id, 'resume')).rejects.toThrow('successful SMTP acceptance');
    await testRef.update({ 'delivery.state': 'ERROR' });
    await expect(setCampaignStatus(campaign.id, 'resume')).rejects.toThrow('successful SMTP acceptance');
    await testRef.update({ 'delivery.state': 'SUCCESS' });
    expect((await setCampaignStatus(campaign.id, 'resume')).status).toBe('running');
    await expect(saveCampaign(campaign.id, editedDraft, user.uid)).rejects.toThrow('Pause a running campaign');
    await setCampaignStatus(campaign.id, 'pause');
    await saveCampaign(campaign.id, { ...editedDraft, subject: 'Another edit' }, user.uid);
    await recordMailDelivery(test.mailId, { delivery: { state: 'PENDING' } },
      { delivery: { state: 'SUCCESS' }, marketing: { testCampaignId: campaign.id } });
    await expect(setCampaignStatus(campaign.id, 'resume')).rejects.toThrow('Send a test email');
  });

  it.each(['start', 'resume'] as const)('rejects a stale browser message on %s even when the latest saved test succeeded', async action => {
    const campaign = await saveCampaign(null, draft, 'admin');
    const ref = db.collection('marketingCampaigns').doc(campaign.id);
    const testId = `marketing_test_${campaign.id}_emulator`;
    await db.collection('mail').doc(testId).set({ delivery: { state: 'SUCCESS' } });
    const latest = { ...draft, subject: 'Saved and tested by another admin' };
    const status = action === 'start' ? 'ready' : 'paused';
    await ref.update({ subject: latest.subject, status, lastTestMailId: testId });
    await expect(setCampaignStatus(campaign.id, action, draft)).rejects.toThrow('saved message changed');
    expect((await ref.get()).get('status')).toBe(status);
    expect((await setCampaignStatus(campaign.id, action, latest)).status).toBe('running');
  });

  it('does not send or charge for a saved test of text that differs from the browser composer', async () => {
    const user = await admin.auth().createUser({ email: `stale-composer-${randomUUID()}@example.com` });
    const campaign = await saveCampaign(null, draft, user.uid);
    const ref = db.collection('marketingCampaigns').doc(campaign.id);
    const latest = { ...draft, subject: 'Another saved message' };
    await ref.update({ status: 'paused' });
    await saveCampaign(campaign.id, latest, user.uid);
    await db.doc('marketingControl/global').set({ dailyCap: 2 });
    const day = db.doc(`marketingDispatchDays/${utcDay(new Date())}`);
    await day.set({ used: 0 });
    await expect(sendTest(campaign.id, user.uid, secret, user.email, draft)).rejects.toThrow('saved message changed');
    expect((await day.get()).get('used')).toBe(0);
    expect((await ref.get()).get('lastTestMailId')).toBeNull();
    const test = await sendTest(campaign.id, user.uid, secret, user.email, latest);
    expect((await db.collection('mail').doc(test.mailId).get()).get('message.subject')).toBe(`[TEST] ${latest.subject}`);
    expect((await day.get()).get('used')).toBe(1);
  });

  it('uses updated content for a worker already in flight during pause, edit and resume', async () => {
    // Isolate the worker from running fixtures left by previous tests.
    const running = await db.collection('marketingCampaigns').where('status', '==', 'running').get();
    for (const doc of running.docs) await doc.ref.update({ status: 'paused' });
    const user = await admin.auth().createUser({ email: `edit-recipient-${randomUUID()}@example.com` });
    await db.doc(`users/${user.uid}`).set({ test: true });
    await db.doc(`users/${user.uid}/legal/agreements`).set({ acceptedMarketingPolicy: true });
    const campaign = await saveCampaign(null, draft, 'admin');
    const ref = db.collection('marketingCampaigns').doc(campaign.id);
    const recipient = ref.collection('recipients').doc(user.uid);
    await ref.update({ status: 'running', stats: { eligible: 1, pending: 1, queued: 0, accepted: 0, failed: 0, skipped: 0 } });
    await recipient.set({ uid: user.uid, status: 'pending', attempt: 0 });
    await db.doc('marketingControl/global').set({ dailyCap: 2 });
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
    const dispatch = dispatchCampaigns(secret);
    try {
      await started;
      await setCampaignStatus(campaign.id, 'pause');
      expect((await recipient.get()).get('status')).toBe('pending');
      await saveCampaign(campaign.id, { ...draft, subject: 'Latest subject',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Latest body.' }] }] },
        cta: { label: 'Latest button', url: 'https://quantified-self.io/help' } }, 'admin');
      const testId = `marketing_test_${campaign.id}_emulator`;
      await db.collection('mail').doc(testId).set({ delivery: { state: 'SUCCESS' } });
      await ref.update({ lastTestMailId: testId });
      await setCampaignStatus(campaign.id, 'resume');
      releaseLookup();
      expect(await dispatch).toBe(1);
      const mail = await db.collection('mail').doc((await recipient.get()).get('mailId')).get();
      expect(mail.get('message.subject')).toBe('Latest subject');
      expect(mail.get('message.html')).toContain('Latest body.');
      expect(mail.get('message.text')).toContain('Latest button: https://quantified-self.io/help');
      expect(mail.get('message.html')).not.toContain('Hello test.');
      expect((await ref.get()).get('stats')).toMatchObject({ eligible: 1, pending: 0, queued: 1 });
    } finally {
      releaseLookup();
      await dispatch;
      lookup.mockRestore();
    }
  });

  it('sends an unsaved test without writing a campaign and still enforces the shared cap', async () => {
    const user = await admin.auth().createUser({ email: `unsaved-admin-${randomUUID()}@example.com` });
    await db.doc('marketingControl/global').set({ dailyCap: 1 });
    await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).set({ used: 0 });
    const campaignsBefore = (await db.collection('marketingCampaigns').get()).size;
    const target = `unsaved-${randomUUID()}@example.org`;
    const testDraft = { ...draft, cta: { label: 'Open Quantified Self', url: 'https://quantified-self.io/dashboard' } };
    const result = await sendTest(null, user.uid, secret, target, testDraft);
    const mail = await db.collection('mail').doc(result.mailId).get();
    expect(mail.get('to')).toBe(target);
    expect(mail.get('message.subject')).toBe(`[TEST] ${draft.subject}`);
    const rendered = new JSDOM(mail.get('message.html')).window.document;
    const letter = rendered.querySelector('table.letter');
    expect(letter?.querySelector('.letter-body')?.textContent).toContain('Hello test.');
    expect(letter?.querySelector('a[href="https://quantified-self.io/dashboard"]')?.textContent).toBe('Open Quantified Self');
    expect(letter?.textContent).toContain('Unsubscribe from product updates');
    expect(mail.get('message.text')).toContain('Open Quantified Self: https://quantified-self.io/dashboard');
    expect(mail.get('message.text')).toContain('/email/unsubscribe?test=1');
    expect(mail.get('marketing.campaignId')).toBeNull();
    expect(mail.get('marketing.testCampaignId')).toBeUndefined();
    expect((await db.collection('marketingCampaigns').get()).size).toBe(campaignsBefore);
    expect((await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).get()).get('used')).toBe(1);
    await expect(sendTest(null, user.uid, secret, target, testDraft)).rejects.toThrow('limit');
  });

  it.each(['draft', 'paused'])('rejects a stale %s test if content changes even with the same update timestamp', async status => {
    const user = await admin.auth().createUser({ email: `edit-admin-${randomUUID()}@example.com` });
    const campaign = await saveCampaign(null, draft, user.uid);
    const ref = db.collection('marketingCampaigns').doc(campaign.id);
    await ref.update({ status });
    await db.doc('marketingControl/global').set({ dailyCap: 10 });
    const day = db.doc(`marketingDispatchDays/${utcDay(new Date())}`);
    await day.set({ used: 0 });
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
      await saveCampaign(campaign.id, { ...draft, subject: 'Changed during test preparation' }, user.uid);
      // Simulate two updates sharing a millisecond timestamp: content must be
      // compared as well, before reserving a slot or marking this as a valid test.
      await ref.update({ updatedAt: campaign.updatedAt });
      releaseLookup();
      await expect(pendingTest).rejects.toThrow('changed');
      expect((await ref.get()).get('lastTestMailId')).toBeNull();
      expect((await day.get()).get('used')).toBe(0);
    } finally {
      releaseLookup();
      lookup.mockRestore();
    }
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
  it('waits for daily time without blocking immediate campaigns, sharing the cap through rollover and cap changes', async () => {
    await isolateWorker();
    const scheduled = await readyScheduledCampaign(4, { time: '09:00', timeZone: 'UTC' });
    const immediate = await readyScheduledCampaign(1, null);
    await scheduled.ref.update({ createdAt: '1990-01-01T00:00:00Z' });
    let now = new Date('2026-10-05T08:00:00Z');
    const clock = () => now;
    await db.doc('marketingControl/global').set({ dailyCap: 2 });
    // Earlier cases use the wall clock, which can match either simulated day.
    await db.doc('marketingDispatchDays/2026-10-05').set({ used: 0 });
    await db.doc('marketingDispatchDays/2026-10-06').set({ used: 0 });
    const started = await setCampaignStatus(scheduled.campaign.id, 'start', { ...draft, schedule: { time: '09:00', timeZone: 'UTC' } }, clock);
    expect(started.nextScheduledSendAt).toBe('2026-10-05T09:00:00.000Z');
    await setCampaignStatus(immediate.campaign.id, 'start', undefined, clock);
    expect(await dispatchCampaigns(secret, clock)).toBe(1);
    expect((await scheduled.ref.get()).get('stats.pending')).toBe(4);
    now = new Date('2026-10-05T09:03:00Z');
    const concurrent = await Promise.all([dispatchCampaigns(secret, clock), dispatchCampaigns(secret, clock)]);
    expect(concurrent.reduce((a, b) => a + b, 0)).toBe(1);
    expect((await db.doc('marketingDispatchDays/2026-10-05').get()).get('used')).toBe(2);
    await db.doc('marketingControl/global').update({ dailyCap: 1 });
    expect(await dispatchCampaigns(secret, clock)).toBe(0);
    await db.doc('marketingControl/global').update({ dailyCap: 3 });
    now = new Date('2026-10-05T15:00:00Z');
    expect(await dispatchCampaigns(secret, clock)).toBe(1);
    now = new Date('2026-10-06T00:00:00Z');
    expect(await dispatchCampaigns(secret, clock)).toBe(0);
    expect((await scheduled.ref.get()).get('stats.pending')).toBe(2);
    now = new Date('2026-10-06T09:00:00Z');
    expect(await dispatchCampaigns(secret, clock)).toBe(2);
    expect((await db.doc('marketingDispatchDays/2026-10-06').get()).get('used')).toBe(2);
    expect((await scheduled.ref.get()).get('stats')).toMatchObject({ eligible: 4, pending: 0, queued: 4 });
    const mails = await db.collection('mail').where('marketing.campaignId', '==', scheduled.campaign.id).get();
    expect(mails.size).toBe(4);
    expect(new Set(mails.docs.map(doc => doc.get('to'))).size).toBe(4);
  }, 20_000);

  it('continues a scheduled batch beyond 25 submissions and preserves progress through pause/resume', async () => {
    await isolateWorker();
    const { campaign, ref } = await readyScheduledCampaign(26, { time: '09:00', timeZone: 'Europe/Helsinki' });
    const clock = () => new Date('2026-10-07T06:00:00Z');
    await db.doc('marketingControl/global').set({ dailyCap: 30 });
    await db.doc('marketingDispatchDays/2026-10-07').set({ used: 0 });
    await setCampaignStatus(campaign.id, 'start', undefined, clock);
    expect(await dispatchCampaigns(secret, clock)).toBe(25);
    await setCampaignStatus(campaign.id, 'pause', undefined, clock);
    expect(await dispatchCampaigns(secret, clock)).toBe(0);
    expect((await setCampaignStatus(campaign.id, 'resume', undefined, clock)).status).toBe('running');
    expect((await ref.get()).get('stats')).toMatchObject({ pending: 1, queued: 25 });
    expect(await dispatchCampaigns(secret, clock)).toBe(1);
    expect((await ref.get()).get('nextScheduledSendAt')).toBe('2026-10-08T06:00:00.000Z');
  });

  it('keeps tests immediate, preserves legacy saves and clones the schedule without a running cursor', async () => {
    await isolateWorker();
    const schedule = { time: '09:00', timeZone: 'Europe/Helsinki' };
    const { campaign, ref, users } = await readyScheduledCampaign(1, schedule);
    const clock = () => new Date('2026-10-08T06:00:00Z');
    await setCampaignStatus(campaign.id, 'start', undefined, clock);
    await setCampaignStatus(campaign.id, 'pause', undefined, clock);
    await ref.update({ scheduledDispatchUtcDate: '2026-10-08' });
    const saved = await saveCampaign(campaign.id, { ...draft, subject: 'Changed message' }, 'admin');
    expect(saved.schedule).toEqual(schedule);
    expect(saved.nextScheduledSendAt).toBe('2026-10-08T06:00:00.000Z');
    expect(saved.lastTestMailId).toBeNull();
    const clone = await cloneCampaign(campaign.id, 'admin');
    expect(clone.schedule).toEqual(schedule);
    expect(clone.nextScheduledSendAt).toBeNull();
    expect(clone.stats.eligible).toBe(0);
    const changedSchedule = { time: '14:00', timeZone: 'Europe/Helsinki' };
    const changed = await saveCampaign(campaign.id, { ...draft, schedule: changedSchedule }, 'admin');
    expect(changed.nextScheduledSendAt).toBeNull();
    expect((await ref.get()).get('scheduledDispatchUtcDate')).toBeNull();
    expect(changed.stats).toEqual(saved.stats);
    await db.doc('marketingControl/global').set({ dailyCap: 10 });
    await db.doc(`marketingDispatchDays/${utcDay(new Date())}`).set({ used: 0 });
    const test = await sendTest(campaign.id, users[0].uid, secret, 'preview@example.com', { ...draft, schedule: changedSchedule });
    expect(test.submitted).toBe(true);
    expect((await db.collection('mail').doc(test.mailId).get()).get('to')).toBe('preview@example.com');
    expect((await ref.get()).get('nextScheduledSendAt')).toBeNull();
    await db.collection('mail').doc(test.mailId).update({ 'delivery.state': 'SUCCESS' });
    await expect(setCampaignStatus(campaign.id, 'resume', { ...draft, schedule }, clock)).rejects.toThrow('saved message changed');
    const resumed = await setCampaignStatus(campaign.id, 'resume', { ...draft, schedule: changedSchedule }, () => new Date('2026-10-08T12:00:00Z'));
    expect(resumed.nextScheduledSendAt).toBe('2026-10-09T11:00:00.000Z');
    expect((await ref.collection('recipients').get()).size).toBe(1);
  });

  it.each(['eligible', 'disabled', 'deleting'] as const)('stops scanning a paused audience during an in-flight %s account lookup', async accountState => {
    await isolateWorker();
    const older = await readyScheduledCampaign(3, null);
    const newer = await readyScheduledCampaign(1, null);
    await older.ref.update({ createdAt: '1990-01-01T00:00:00Z' });
    const firstUid = older.users.map(user => user.uid).sort()[0];
    if (accountState === 'deleting') await db.doc(`userDeletionTombstones/${firstUid}`).set({ active: true });
    const clock = () => new Date('2026-10-10T08:00:00Z');
    await setCampaignStatus(older.campaign.id, 'start', undefined, clock);
    await setCampaignStatus(newer.campaign.id, 'start', undefined, clock);
    await db.doc('marketingControl/global').set({ dailyCap: 10 });
    await db.doc('marketingDispatchDays/2026-10-10').set({ used: 0 });
    const auth = admin.auth();
    const originalGetUser = auth.getUser.bind(auth);
    let lookupStarted!: () => void;
    let releaseLookup!: () => void;
    const started = new Promise<void>(resolve => { lookupStarted = resolve; });
    const released = new Promise<void>(resolve => { releaseLookup = resolve; });
    const lookup = vi.spyOn(auth, 'getUser').mockImplementation(async uid => {
      if (uid === firstUid) { lookupStarted(); await released; }
      const user = await originalGetUser(uid);
      return uid === firstUid && accountState === 'disabled' ? { ...user, disabled: true } : user;
    });
    const worker = dispatchCampaigns(secret, clock);
    try {
      await started;
      await setCampaignStatus(older.campaign.id, 'pause', undefined, clock);
      releaseLookup();
      expect(await worker).toBe(1);
      const audience = new Set(older.users.map(user => user.uid));
      expect(lookup.mock.calls.filter(([uid]) => audience.has(uid))).toHaveLength(1);
      expect((await older.ref.get()).get('stats')).toMatchObject({ pending: 3, queued: 0, skipped: 0 });
      expect((await newer.ref.get()).get('stats.queued')).toBe(1);
    } finally { releaseLookup(); await worker; lookup.mockRestore(); }
  });

  it.each(['disabled', 'deleting'] as const)('waits before skipping an in-flight %s account after the schedule changes', async accountState => {
    await isolateWorker();
    const { campaign, ref, users, testId } = await readyScheduledCampaign(1, null);
    const uid = users[0].uid;
    if (accountState === 'deleting') await db.doc(`userDeletionTombstones/${uid}`).set({ active: true });
    const clock = () => new Date('2026-10-10T08:00:00Z');
    await setCampaignStatus(campaign.id, 'start', undefined, clock);
    await db.doc('marketingControl/global').set({ dailyCap: 10 });
    await db.doc('marketingDispatchDays/2026-10-10').set({ used: 0 });
    const auth = admin.auth();
    const originalGetUser = auth.getUser.bind(auth);
    let lookupStarted!: () => void;
    let releaseLookup!: () => void;
    const started = new Promise<void>(resolve => { lookupStarted = resolve; });
    const released = new Promise<void>(resolve => { releaseLookup = resolve; });
    const lookup = vi.spyOn(auth, 'getUser').mockImplementation(async accountUid => {
      if (accountUid === uid) { lookupStarted(); await released; }
      const user = await originalGetUser(accountUid);
      return accountUid === uid && accountState === 'disabled' ? { ...user, disabled: true } : user;
    });
    const worker = dispatchCampaigns(secret, clock);
    try {
      await started;
      await setCampaignStatus(campaign.id, 'pause', undefined, clock);
      await saveCampaign(campaign.id, { ...draft, schedule: { time: '09:00', timeZone: 'UTC' } }, 'admin');
      await ref.update({ lastTestMailId: testId });
      await setCampaignStatus(campaign.id, 'resume', undefined, clock);
      releaseLookup();
      expect(await worker).toBe(0);
      expect((await ref.get()).get('stats')).toMatchObject({ pending: 1, queued: 0, skipped: 0 });
      expect((await ref.collection('recipients').doc(uid).get()).get('status')).toBe('pending');
      expect((await db.doc('marketingDispatchDays/2026-10-10').get()).get('used')).toBe(0);
      lookup.mockImplementation(originalGetUser);
      if (accountState === 'deleting') await db.doc(`userDeletionTombstones/${uid}`).update({ expireAt: admin.firestore.Timestamp.fromMillis(0) });
      expect(await dispatchCampaigns(secret, () => new Date('2026-10-10T09:00:00Z'))).toBe(1);
      expect((await ref.get()).get('stats')).toMatchObject({ pending: 0, queued: 1, skipped: 0 });
      expect((await db.doc('marketingDispatchDays/2026-10-10').get()).get('used')).toBe(1);
    } finally { releaseLookup(); await worker; lookup.mockRestore(); }
  });

  it('rechecks a changed schedule inside an in-flight mail reservation', async () => {
    await isolateWorker();
    const { campaign, ref, users, testId } = await readyScheduledCampaign(1, null);
    const clock = () => new Date('2026-10-10T08:00:00Z');
    await setCampaignStatus(campaign.id, 'start', undefined, clock);
    await db.doc('marketingControl/global').set({ dailyCap: 10 });
    await db.doc('marketingDispatchDays/2026-10-10').set({ used: 0 });
    const auth = admin.auth();
    const originalGetUser = auth.getUser.bind(auth);
    let lookupStarted!: () => void;
    let releaseLookup!: () => void;
    const started = new Promise<void>(resolve => { lookupStarted = resolve; });
    const released = new Promise<void>(resolve => { releaseLookup = resolve; });
    const lookup = vi.spyOn(auth, 'getUser').mockImplementation(async uid => {
      if (uid === users[0].uid) { lookupStarted(); await released; }
      return originalGetUser(uid);
    });
    const worker = dispatchCampaigns(secret, clock);
    try {
      await started;
      await setCampaignStatus(campaign.id, 'pause', undefined, clock);
      await saveCampaign(campaign.id, { ...draft, schedule: { time: '09:00', timeZone: 'UTC' } }, 'admin');
      await ref.update({ lastTestMailId: testId });
      await setCampaignStatus(campaign.id, 'resume', undefined, clock);
      releaseLookup();
      expect(await worker).toBe(0);
      expect((await ref.get()).get('stats.pending')).toBe(1);
      expect((await db.doc('marketingDispatchDays/2026-10-10').get()).get('used')).toBe(0);
      expect((await db.collection('mail').where('marketing.campaignId', '==', campaign.id).get()).empty).toBe(true);
    } finally { releaseLookup(); await worker; lookup.mockRestore(); }
  });


});
