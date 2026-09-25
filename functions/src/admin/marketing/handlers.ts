import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { onAdminCall } from '../../shared/auth';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { SECRET_PARAMS } from '../../secrets';
import {
  cloneCampaign, dispatchCampaigns, getCampaign, listCampaigns, optOut, prepareCampaign,
  previewCampaign, recordMailDelivery, saveCampaign, sendTest, setCampaignStatus,
  setDailyCap, verifyUnsubscribeToken,
} from './service';

const region = 'europe-west2';
const callable = (name: keyof typeof FUNCTIONS_MANIFEST) => ({ region: FUNCTIONS_MANIFEST[name].region, memory: '512MiB' as const });
const secret = SECRET_PARAMS.MARKETING_UNSUBSCRIBE_SIGNING_KEY;
function signingKey(): string {
  const value = secret.value();
  if (!value || value.length < 32) throw new Error('Marketing unsubscribe signing key must contain at least 32 characters.');
  return value;
}

export const listMarketingCampaigns = onAdminCall<Record<string, unknown>>(callable('listMarketingCampaigns'), () => listCampaigns());
export const saveMarketingCampaign = onAdminCall<Record<string, unknown>>(callable('saveMarketingCampaign'), request => saveCampaign(request.data?.id, request.data?.draft, request.auth!.uid));
export const cloneMarketingCampaign = onAdminCall<Record<string, unknown>>(callable('cloneMarketingCampaign'), request => cloneCampaign(request.data?.id, request.auth!.uid));
export const previewMarketingCampaign = onAdminCall<Record<string, unknown>>(callable('previewMarketingCampaign'), request => previewCampaign(request.data?.draft));
export const prepareMarketingCampaign = onAdminCall<Record<string, unknown>>({ ...callable('prepareMarketingCampaign'), timeoutSeconds: 540 }, request => prepareCampaign(request.data?.id));
export const setMarketingDailyCap = onAdminCall<Record<string, unknown>>(callable('setMarketingDailyCap'), request => setDailyCap(request.data?.dailyCap));
export const sendMarketingTest = onAdminCall<Record<string, unknown>>({ ...callable('sendMarketingTest'), secrets: [secret] }, request =>
  sendTest(request.data?.id, request.auth!.uid, signingKey(), request.data?.to, request.data?.draft));
export const changeMarketingCampaignStatus = onAdminCall<Record<string, unknown>>({ ...callable('changeMarketingCampaignStatus'), timeoutSeconds: 540, secrets: [secret] }, async request => {
  const action = request.data?.action;
  if (action !== 'start' && action !== 'pause' && action !== 'resume' && action !== 'retry') {
    throw new HttpsError('invalid-argument', 'Unknown campaign action.');
  }
  await setCampaignStatus(request.data?.id, action);
  if (action === 'start' || action === 'resume') await dispatchCampaigns(signingKey());
  return getCampaign(request.data?.id);
});
export const dispatchMarketingCampaigns = onSchedule({ schedule: 'every 5 minutes', timeZone: 'UTC', region,
  memory: '512MiB', timeoutSeconds: 540, secrets: [secret] }, async () => {
  const submitted = await dispatchCampaigns(signingKey());
  logger.info('Marketing dispatch complete', { submitted });
});
export const trackMarketingDelivery = onDocumentUpdated({ document: 'mail/{mailId}', region, memory: '256MiB' }, async event => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  await recordMailDelivery(event.params.mailId, before, after);
});

function confirmationPage(message: string, token?: string): string {
  const action = token ? `<form method="post" action="/email/unsubscribe?token=${encodeURIComponent(token)}"><button type="submit">Unsubscribe</button></form>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences · Quantified Self</title><style>body{font:18px/1.5 system-ui,sans-serif;max-width:580px;margin:10vh auto;padding:20px;color:#172033}button{background:#174ea6;color:white;border:0;border-radius:4px;padding:12px 20px;font:inherit;cursor:pointer}</style></head><body><h1>Email preferences</h1><p>${message}</p>${action}</body></html>`;
}
export async function handleMarketingUnsubscribe(request: Request, response: Response, signingKey: string): Promise<void> {
  response.set('Cache-Control', 'no-store');
  response.set('X-Robots-Tag', 'noindex, nofollow');
  response.set('Referrer-Policy', 'no-referrer');
  response.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  response.type('html');
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.set('Allow', 'GET, POST').status(405).send(confirmationPage('This method is not supported.'));
    return;
  }
  if (request.query.test === '1' && !request.query.token) {
    response.status(200).send(confirmationPage('This was a test email. No marketing preference was changed.'));
    return;
  }
  const token = request.query.token;
  const uid = verifyUnsubscribeToken(token, signingKey);
  if (!uid) {
    response.status(400).send(confirmationPage('This unsubscribe link is invalid.'));
    return;
  }
  if (request.method === 'GET') {
    response.status(200).send(confirmationPage('Confirm that you want to stop marketing and product update emails from Quantified Self.', token as string));
    return;
  }
  await optOut(uid);
  response.status(200).send(confirmationPage('You are unsubscribed from marketing and product update emails.'));
}
export const marketingUnsubscribe = onRequest({ region, memory: '256MiB', secrets: [secret] }, async (request, response) => {
  await handleMarketingUnsubscribe(request, response, signingKey());
});
