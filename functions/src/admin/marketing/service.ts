import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import * as path from 'path';
import type { MarketingAudienceExclusions, MarketingCampaignDraft, MarketingCampaignListResponse, MarketingCampaignStats, MarketingCampaignView, MarketingPlan, MarketingRecipientStatus } from '../../../../shared/admin-marketing';
import { ACCEPTED_MARKETING_POLICY_FIELD, USER_LEGAL_COLLECTION_NAME } from '../../../../shared/user-profile-firestore';
import { ACTIVE_SUBSCRIPTION_STATUSES } from '../shared/subscription.constants';
import { getUserDeletionGuardState, getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { getExpireAtTimestamp, TTL_CONFIG } from '../../shared/ttl-config';
import { EMAIL_LINKS, MARKETING_EMAIL_FROM, MARKETING_EMAIL_REPLY_TO } from '../../email/config';
import { createLocalEmailTemplateRenderer } from '../../email/template-renderer';
import { MANUAL_CAMPAIGN_EMAIL_TEMPLATE_CATALOG } from '../../email/template-catalog';
import { renderMarketingContent, validateMarketingDraft } from '../../email/marketing-content';
import { blankStats, DEFAULT_MARKETING_DAILY_CAP, remainingToday, selectedPlan, signupInRange, transitionStats, utcDay, validDailyCap } from './core';

const db = () => admin.firestore();
const campaigns = () => db().collection('marketingCampaigns');
const control = () => db().doc('marketingControl/global');
const dayRef = (day: string) => db().collection('marketingDispatchDays').doc(day);
const renderer = createLocalEmailTemplateRenderer(path.join(__dirname, '../../../templates'));
const template = MANUAL_CAMPAIGN_EMAIL_TEMPLATE_CATALOG.find(entry => entry.id === 'marketing_campaign')!;
const settingsUrl = 'https://quantified-self.io/settings';
const unsubscribeBase = 'https://quantified-self.io/email/unsubscribe';

function badRequest(error: unknown): never {
  throw new HttpsError('invalid-argument', error instanceof Error ? error.message : 'Invalid campaign request.');
}
function checkedId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{10,60}$/.test(value)) badRequest('Invalid campaign ID.');
  return value as string;
}
function asView(id: string, data: FirebaseFirestore.DocumentData): MarketingCampaignView {
  return { id, name: data.name, subject: data.subject, content: data.content, cta: data.cta, filters: data.filters,
    status: data.status, stats: data.stats, exclusions: data.exclusions, createdAt: data.createdAt,
    updatedAt: data.updatedAt, startedAt: data.startedAt || null,
    lastTestMailId: data.lastTestMailId || null, lastTestState: data.lastTestState || null };
}
async function withTestState(view: MarketingCampaignView): Promise<MarketingCampaignView> {
  if (!view.lastTestMailId) return view;
  const mail = await db().collection('mail').doc(view.lastTestMailId).get();
  return { ...view, lastTestState: mail.exists ? (mail.get('delivery.state') || view.lastTestState) : null };
}
function blankExclusions(): MarketingAudienceExclusions {
  return { noAuth: 0, disabledOrAdmin: 0, noEmail: 0, noProfile: 0, deletionMarked: 0, plan: 0, signupDate: 0 };
}
function isMissingAuth(error: unknown): boolean {
  const item = error as { code?: string; errorInfo?: { code?: string } };
  return item.code === 'auth/user-not-found' || item.errorInfo?.code === 'auth/user-not-found';
}
async function getAuth(uid: string): Promise<admin.auth.UserRecord | null> {
  try { return await admin.auth().getUser(uid); } catch (error) { if (isMissingAuth(error)) return null; throw error; }
}
export function authAllowed(user: admin.auth.UserRecord | null): user is admin.auth.UserRecord {
  return !!user && !user.disabled && user.customClaims?.admin !== true && !!user.email;
}
function timestampMs(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') return (value as { toMillis: () => number }).toMillis();
  return 0;
}
async function currentPlan(uid: string, tx?: FirebaseFirestore.Transaction): Promise<MarketingPlan> {
  const query = db().collection('customers').doc(uid).collection('subscriptions')
    .where('status', 'in', [...ACTIVE_SUBSCRIPTION_STATUSES]);
  const snapshot = tx ? await tx.get(query) : await query.get();
  let winner: { created: number; role: MarketingPlan } | null = null;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.role !== 'basic' && data.role !== 'pro') continue;
    const created = timestampMs(data.created);
    if (!winner || created > winner.created) winner = { created, role: data.role };
  }
  return winner?.role || 'free';
}

export function makeUnsubscribeToken(uid: string, secret: string): string {
  const payload = Buffer.from(uid, 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(`marketing-unsubscribe:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}
export function verifyUnsubscribeToken(token: unknown, secret: string): string | null {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{2,200}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [payload, signature] = token.split('.');
  const uid = Buffer.from(payload, 'base64url').toString('utf8');
  if (!uid || Buffer.byteLength(uid, 'utf8') > 128 || uid.includes('/') ||
      Array.from(uid).some(character => character.charCodeAt(0) < 32)) return null;
  const expected = createHmac('sha256', secret).update(`marketing-unsubscribe:${payload}`).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return uid;
}

function renderMessage(draft: MarketingCampaignDraft, firstName: string, uid: string, secret: string) {
  const content = renderMarketingContent(draft);
  const unsubscribeUrl = `${unsubscribeBase}?token=${encodeURIComponent(makeUnsubscribeToken(uid, secret))}`;
  const rendered = renderer.render(template, {
    subject: draft.subject, email_title: draft.subject, first_name: firstName,
    body_html: content.bodyHtml, body_text: content.bodyText,
    cta_html: content.ctaHtml, cta_text: content.ctaText,
    product_url: EMAIL_LINKS.product, settings_url: settingsUrl, unsubscribe_url: unsubscribeUrl,
  });
  return { rendered: { ...rendered, subject: draft.subject }, unsubscribeUrl };
}
function mailPayload(draft: MarketingCampaignDraft, email: string, firstName: string, uid: string, secret: string, campaignId: string | null, attempt: number) {
  const { rendered, unsubscribeUrl } = renderMessage(draft, firstName, uid, secret);
  return {
    to: email, from: MARKETING_EMAIL_FROM, replyTo: MARKETING_EMAIL_REPLY_TO,
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    message: rendered, marketing: { campaignId, uid, attempt },
    expireAt: getExpireAtTimestamp(TTL_CONFIG.MAIL_IN_DAYS),
  };
}

export async function listCampaigns(): Promise<MarketingCampaignListResponse> {
  const now = utcDay(new Date());
  const [campaignDocs, controlDoc, usedDoc] = await Promise.all([
    campaigns().orderBy('createdAt', 'desc').limit(100).get(), control().get(), dayRef(now).get(),
  ]);
  const views = await Promise.all(campaignDocs.docs.map(async doc => withTestState(asView(doc.id, doc.data()))));
  return { campaigns: views,
    dailyCap: controlDoc.exists ? validDailyCap(controlDoc.get('dailyCap')) : DEFAULT_MARKETING_DAILY_CAP,
    usedToday: usedDoc.get('used') || 0, utcDate: now };
}
export async function getCampaign(idInput: unknown): Promise<MarketingCampaignView> {
  const id = checkedId(idInput);
  const doc = await campaigns().doc(id).get();
  if (!doc.exists) throw new HttpsError('not-found', 'Campaign not found.');
  return withTestState(asView(id, doc.data()!));
}
export async function saveCampaign(idInput: unknown, input: unknown, actorUid: string): Promise<MarketingCampaignView> {
  let draft: MarketingCampaignDraft;
  try { draft = validateMarketingDraft(input); } catch (error) { badRequest(error); }
  const now = new Date().toISOString();
  if (idInput === null || idInput === undefined) {
    const ref = campaigns().doc();
    await ref.create({ ...draft!, status: 'draft', stats: blankStats(), exclusions: blankExclusions(), createdAt: now,
      updatedAt: now, createdBy: actorUid, startedAt: null, lastTestMailId: null, lastTestState: null });
    return getCampaign(ref.id);
  }
  const id = checkedId(idInput);
  await db().runTransaction(async tx => {
    const ref = campaigns().doc(id);
    const doc = await tx.get(ref);
    if (!doc.exists) throw new HttpsError('not-found', 'Campaign not found.');
    if (doc.get('status') !== 'draft') throw new HttpsError('failed-precondition', 'Clone this campaign to edit its content.');
    tx.update(ref, { ...draft!, updatedAt: now });
  });
  return getCampaign(id);
}
export async function cloneCampaign(idInput: unknown, actorUid: string): Promise<MarketingCampaignView> {
  const source = await getCampaign(idInput);
  return saveCampaign(null, { name: `Copy of ${source.name}`.slice(0, 120), subject: source.subject,
    content: source.content, cta: source.cta, filters: source.filters }, actorUid);
}
export function previewCampaign(input: unknown): { subject: string; html: string; text: string } {
  let draft: MarketingCampaignDraft;
  try { draft = validateMarketingDraft(input); } catch (error) { badRequest(error); }
  return renderMessage(draft!, 'friend', 'preview-user', 'preview-only-signing-key').rendered;
}

export async function prepareCampaign(idInput: unknown): Promise<MarketingCampaignView> {
  const id = checkedId(idInput);
  const ref = campaigns().doc(id);
  const snapshotId = randomUUID();
  const draft = await db().runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (!doc.exists) throw new HttpsError('not-found', 'Campaign not found.');
    if (doc.get('status') !== 'draft') throw new HttpsError('failed-precondition', 'Only drafts can prepare an audience.');
    tx.update(ref, { status: 'preparing', snapshotId, updatedAt: new Date().toISOString() });
    return validateMarketingDraft(doc.data());
  });
  try {
    const consentDocs = await db().collectionGroup(USER_LEGAL_COLLECTION_NAME)
      .where(ACCEPTED_MARKETING_POLICY_FIELD, '==', true).get();
    const exclusions = blankExclusions();
    const candidates = consentDocs.docs.filter(doc => /^users\/[^/]+\/legal\/agreements$/.test(doc.ref.path));
    const eligible: Array<{ uid: string; plan: MarketingPlan }> = [];
    for (let offset = 0; offset < candidates.length; offset += 20) {
      const chunk = candidates.slice(offset, offset + 20);
      const results = await Promise.all(chunk.map(async doc => {
        const uid = doc.ref.parent.parent!.id;
        const user = await getAuth(uid);
        if (!user) return { exclusion: 'noAuth' as const };
        if (user.disabled || user.customClaims?.admin === true) return { exclusion: 'disabledOrAdmin' as const };
        if (!user.email) return { exclusion: 'noEmail' as const };
        const guard = await getUserDeletionGuardState(db(), uid);
        if (!guard.userExists) return { exclusion: 'noProfile' as const };
        if (guard.deletionInProgress) return { exclusion: 'deletionMarked' as const };
        if (!signupInRange(user.metadata.creationTime, draft.filters)) return { exclusion: 'signupDate' as const };
        const plan = await currentPlan(uid);
        if (!selectedPlan(plan, draft.filters)) return { exclusion: 'plan' as const };
        return { recipient: { uid, plan } };
      }));
      for (const item of results) {
        if (item.exclusion) exclusions[item.exclusion]++;
        else eligible.push(item.recipient);
      }
    }
    // A failed previous preparation may have written recipients. The new snapshot ID
    // prevents them from being dispatched; remove them before making this one ready.
    const existing = await ref.collection('recipients').get();
    for (let i = 0; i < existing.size; i += 400) {
      const batch = db().batch();
      for (const doc of existing.docs.slice(i, i + 400)) batch.delete(doc.ref);
      await batch.commit();
    }
    for (let i = 0; i < eligible.length; i += 400) {
      const batch = db().batch();
      for (const recipient of eligible.slice(i, i + 400)) {
        batch.set(ref.collection('recipients').doc(recipient.uid), {
          ...recipient, snapshotId, status: 'pending', attempt: 0, mailId: null,
        });
      }
      await batch.commit();
    }
    await db().runTransaction(async tx => {
      const latest = await tx.get(ref);
      if (latest.get('status') !== 'preparing' || latest.get('snapshotId') !== snapshotId) {
        throw new HttpsError('aborted', 'Campaign preparation changed.');
      }
      tx.update(ref, { status: 'ready', stats: blankStats(eligible.length), exclusions,
        preparedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });
    return getCampaign(id);
  } catch (error) {
    logger.error('Marketing audience preparation failed', { campaignId: id, error });
    await db().runTransaction(async tx => {
      const latest = await tx.get(ref);
      if (latest.get('status') === 'preparing' && latest.get('snapshotId') === snapshotId) {
        tx.update(ref, { status: 'draft', updatedAt: new Date().toISOString() });
      }
    });
    throw error;
  }
}

export async function setDailyCap(input: unknown): Promise<MarketingCampaignListResponse> {
  let dailyCap: number;
  try { dailyCap = validDailyCap(input); } catch (error) { badRequest(error); }
  await control().set({ dailyCap: dailyCap!, updatedAt: new Date().toISOString() }, { merge: true });
  return listCampaigns();
}

export async function reserveMail(mailId: string, data: Record<string, unknown>,
  nowProvider: () => Date = () => new Date()): Promise<boolean> {
  return db().runTransaction(async tx => {
    const now = nowProvider();
    const day = dayRef(utcDay(now));
    const mail = db().collection('mail').doc(mailId);
    const [controlDoc, dayDoc, mailDoc] = await Promise.all([tx.get(control()), tx.get(day), tx.get(mail)]);
    const cap = controlDoc.exists ? validDailyCap(controlDoc.get('dailyCap')) : DEFAULT_MARKETING_DAILY_CAP;
    const used = dayDoc.get('used') || 0;
    if (remainingToday(cap, used) === 0 || mailDoc.exists) return false;
    tx.set(day, { used: used + 1, updatedAt: now.toISOString() }, { merge: true });
    tx.create(mail, data);
    return true;
  });
}

export async function sendTest(idInput: unknown, adminUid: string, secret: string): Promise<{ mailId: string; submitted: boolean }> {
  const campaign = await getCampaign(idInput);
  if (campaign.status !== 'ready') throw new HttpsError('failed-precondition', 'Prepare the audience before a test send.');
  const user = await getAuth(adminUid);
  if (!user?.email || user.disabled) throw new HttpsError('failed-precondition', 'Your admin account needs an enabled email address.');
  const ref = campaigns().doc(campaign.id);
  const mailId = `marketing_test_${campaign.id}_${randomUUID()}`;
  const mail = mailPayload(campaign, user.email, user.displayName?.trim().split(/\s+/)[0] || '', adminUid, secret, null, 1);
  const submitted = await reserveMail(mailId, { ...mail, marketing: { ...mail.marketing, testCampaignId: campaign.id } });
  if (!submitted) throw new HttpsError('resource-exhausted', 'The UTC daily marketing limit has been reached.');
  await ref.update({ lastTestMailId: mailId, lastTestState: 'PENDING', updatedAt: new Date().toISOString() });
  return { mailId, submitted };
}

export async function setCampaignStatus(idInput: unknown, action: 'start' | 'pause' | 'resume' | 'retry'): Promise<MarketingCampaignView> {
  const id = checkedId(idInput);
  const ref = campaigns().doc(id);
  if (action === 'retry') {
    const campaign = await getCampaign(id);
    if (campaign.status !== 'paused' && campaign.status !== 'completed') throw new HttpsError('failed-precondition', 'Pause or complete the campaign before retrying failed recipients.');
    const failed = await ref.collection('recipients').where('status', '==', 'failed').get();
    for (const doc of failed.docs) {
      await db().runTransaction(async tx => {
        const [campaignDoc, recipientDoc] = await Promise.all([tx.get(ref), tx.get(doc.ref)]);
        if (recipientDoc.get('status') !== 'failed') return;
        tx.update(doc.ref, { status: 'pending', mailId: null });
        tx.update(ref, { stats: transitionStats(campaignDoc.get('stats') as MarketingCampaignStats, 'failed', 'pending'), status: 'paused' });
      });
    }
    return getCampaign(id);
  }
  await db().runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (!doc.exists) throw new HttpsError('not-found', 'Campaign not found.');
    const status = doc.get('status');
    if (action === 'start') {
      if (status !== 'ready') throw new HttpsError('failed-precondition', 'Prepare the campaign before starting.');
      const testId = doc.get('lastTestMailId');
      if (!testId) throw new HttpsError('failed-precondition', 'Send a test email and wait for SMTP acceptance first.');
      const test = await tx.get(db().collection('mail').doc(testId));
      if (test.get('delivery.state') !== 'SUCCESS') throw new HttpsError('failed-precondition', 'Wait for successful SMTP acceptance of the test email.');
    } else if (action === 'pause' && status !== 'running') throw new HttpsError('failed-precondition', 'Only a running campaign can be paused.');
    else if (action === 'resume' && status !== 'paused') throw new HttpsError('failed-precondition', 'Only a paused campaign can resume.');
    tx.update(ref, { status: action === 'pause' ? 'paused' : 'running',
      ...(action === 'start' ? { startedAt: new Date().toISOString() } : {}), updatedAt: new Date().toISOString() });
  });
  return getCampaign(id);
}

async function skipRecipient(campaignRef: FirebaseFirestore.DocumentReference, recipientRef: FirebaseFirestore.DocumentReference, reason: string): Promise<void> {
  await db().runTransaction(async tx => {
    const [campaign, recipient] = await Promise.all([tx.get(campaignRef), tx.get(recipientRef)]);
    if (campaign.get('status') !== 'running' || recipient.get('status') !== 'pending') return;
    tx.update(recipientRef, { status: 'skipped', skippedReason: reason, skippedAt: new Date().toISOString() });
    tx.update(campaignRef, { stats: transitionStats(campaign.get('stats') as MarketingCampaignStats, 'pending', 'skipped') });
  });
}

export async function dispatchCampaigns(secret: string): Promise<number> {
  const today = utcDay(new Date());
  const [capDoc, usedDoc] = await Promise.all([control().get(), dayRef(today).get()]);
  const cap = capDoc.exists ? validDailyCap(capDoc.get('dailyCap')) : DEFAULT_MARKETING_DAILY_CAP;
  // Bound each invocation; the schedule resumes remaining work without holding
  // an admin callable open for a large configured daily cap.
  let available = Math.min(25, remainingToday(cap, usedDoc.get('used') || 0));
  if (!available) return 0;
  let submitted = 0;
  const running = await campaigns().where('status', '==', 'running').orderBy('createdAt').limit(100).get();
  for (const campaignDoc of running.docs) {
    if (!available) break;
    const campaignRef = campaignDoc.ref;
    const draft = validateMarketingDraft(campaignDoc.data());
    const recipientDocs = await campaignRef.collection('recipients').where('status', '==', 'pending').limit(available + 20).get();
    for (const recipientDoc of recipientDocs.docs) {
      if (!available) break;
      const recipient = recipientDoc.data();
      const uid = recipientDoc.id;
      const user = await getAuth(uid);
      if (!authAllowed(user)) { await skipRecipient(campaignRef, recipientDoc.ref, 'account-or-email'); continue; }
      const guard = await getUserDeletionGuardState(db(), uid);
      if (guard.shouldSkip) { await skipRecipient(campaignRef, recipientDoc.ref, 'deleted'); continue; }
      const attempt = (recipient.attempt || 0) + 1;
      const mailId = `marketing_${campaignDoc.id}_${uid}_${attempt}`;
      const consentRef = db().doc(`users/${uid}/legal/agreements`);
      const submittedMail = await db().runTransaction(async tx => {
        const day = dayRef(utcDay(new Date()));
        const mail = db().collection('mail').doc(mailId);
        const [controlDoc, dayDoc, campaign, recipientNow, consent, latestGuard, subscriptions, existingMail] = await Promise.all([
          tx.get(control()), tx.get(day), tx.get(campaignRef), tx.get(recipientDoc.ref), tx.get(consentRef),
          getUserDeletionGuardStateInTransaction(db(), tx, uid),
          tx.get(db().collection('customers').doc(uid).collection('subscriptions').where('status', 'in', [...ACTIVE_SUBSCRIPTION_STATUSES])),
          tx.get(mail),
        ]);
        if (campaign.get('status') !== 'running' || recipientNow.get('status') !== 'pending' || existingMail.exists) return 'stale';
        const latestCap = controlDoc.exists ? validDailyCap(controlDoc.get('dailyCap')) : DEFAULT_MARKETING_DAILY_CAP;
        const used = dayDoc.get('used') || 0;
        if (used >= latestCap) return 'capped';
        let plan: MarketingPlan = 'free';
        let latestCreated = -Infinity;
        for (const doc of subscriptions.docs) {
          const item = doc.data();
          if ((item.role === 'pro' || item.role === 'basic') && timestampMs(item.created) > latestCreated) {
            plan = item.role; latestCreated = timestampMs(item.created);
          }
        }
        if (!consent.exists || consent.get(ACCEPTED_MARKETING_POLICY_FIELD) !== true || latestGuard.shouldSkip ||
            !selectedPlan(plan, draft.filters)) {
          tx.update(recipientDoc.ref, { status: 'skipped', skippedReason: 'consent-account-or-plan', skippedAt: new Date().toISOString() });
          tx.update(campaignRef, { stats: transitionStats(campaign.get('stats') as MarketingCampaignStats, 'pending', 'skipped') });
          return 'skipped';
        }
        tx.set(day, { used: used + 1, updatedAt: new Date().toISOString() }, { merge: true });
        tx.create(mail, mailPayload(draft, user.email!, user.displayName?.trim().split(/\s+/)[0] || '', uid, secret, campaignDoc.id, attempt));
        tx.update(recipientDoc.ref, { status: 'queued', mailId, attempt, queuedAt: new Date().toISOString() });
        tx.update(campaignRef, { stats: transitionStats(campaign.get('stats') as MarketingCampaignStats, 'pending', 'queued') });
        return 'submitted';
      });
      if (submittedMail === 'capped') return submitted;
      if (submittedMail === 'submitted') { submitted++; available--; }
    }
    const latest = await campaignRef.get();
    const stats = latest.get('stats') as MarketingCampaignStats;
    if (stats.pending === 0 && stats.queued === 0) await campaignRef.update({ status: 'completed', updatedAt: new Date().toISOString() });
  }
  return submitted;
}

export async function recordMailDelivery(mailId: string, before: FirebaseFirestore.DocumentData, after: FirebaseFirestore.DocumentData): Promise<void> {
  const marketing = after.marketing as { campaignId?: string | null; testCampaignId?: string; uid?: string } | undefined;
  const state = after.delivery?.state;
  if (!marketing || before.delivery?.state === state || (state !== 'SUCCESS' && state !== 'ERROR')) return;
  if (marketing.testCampaignId) {
    const testRef = campaigns().doc(marketing.testCampaignId);
    await db().runTransaction(async tx => {
      const doc = await tx.get(testRef);
      if (doc.exists && doc.get('lastTestMailId') === mailId) tx.update(testRef, { lastTestState: state });
    });
    return;
  }
  if (!marketing.campaignId || !marketing.uid) return;
  const campaignRef = campaigns().doc(marketing.campaignId);
  const recipientRef = campaignRef.collection('recipients').doc(marketing.uid);
  const to: MarketingRecipientStatus = state === 'SUCCESS' ? 'accepted' : 'failed';
  await db().runTransaction(async tx => {
    const [campaign, recipient] = await Promise.all([tx.get(campaignRef), tx.get(recipientRef)]);
    if (!campaign.exists || !recipient.exists || recipient.get('mailId') !== mailId || recipient.get('status') !== 'queued') return;
    tx.update(recipientRef, { status: to, deliveryState: state, deliveryAt: new Date().toISOString() });
    const stats = transitionStats(campaign.get('stats') as MarketingCampaignStats, 'queued', to);
    tx.update(campaignRef, { stats, ...(stats.pending === 0 && stats.queued === 0 && campaign.get('status') === 'running' ? { status: 'completed' } : {}) });
  });
}

export async function optOut(uid: string): Promise<void> {
  const ref = db().doc(`users/${uid}/legal/agreements`);
  await db().runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (!doc.exists) return;
    tx.update(ref, { [ACCEPTED_MARKETING_POLICY_FIELD]: false, marketingUnsubscribedAt: FieldValue.serverTimestamp() });
  });
}
