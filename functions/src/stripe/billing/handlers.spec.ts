import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { stripeBillingWebhook } from './handlers';
import { admitBillingEvent } from './queue';
vi.mock('./queue', () => ({ admitBillingEvent: vi.fn(), observeBilling: vi.fn(), admitBillingCheckout: vi.fn(), processBillingJob: vi.fn(), writeCheckoutError: vi.fn() }));
const secret = 'whsec_synthetic';
const event = { id: 'evt_synthetic', created: 1, livemode: false, type: 'product.updated', data: { object: { id: 'prod_synthetic' } } };
async function invoke(body: object, signatureBody = body, signingSecret = secret) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: JSON.stringify(signatureBody), secret: signingSecret });
  const response = { sendStatus: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() };
  await stripeBillingWebhook({ method: 'POST', rawBody, body: { malicious: 'parsed body is not the signed body' }, header: () => signature } as any, response as any);
  return response;
}
describe('Stripe webhook admission boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('GCLOUD_PROJECT', 'demo-stripe-billing'); vi.stubEnv('STRIPE_BILLING_WEBHOOK_SECRET', secret); });
  it('verifies the raw body and commits minimal admission before acknowledging', async () => {
    let committed = false;
    vi.mocked(admitBillingEvent).mockImplementationOnce(async () => { committed = true; return 'job'; });
    const response = await invoke(event);
    expect(committed).toBe(true); expect(response.status).toHaveBeenCalledWith(200);
    expect(admitBillingEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventId: event.id, objectId: 'prod_synthetic' }));
    expect(Object.keys(vi.mocked(admitBillingEvent).mock.calls[0][1])).not.toContain('data');
  });
  it('rejects tampering, wrong signatures, live events and Connect accounts', async () => {
    for (const response of [await invoke(event, { ...event, id: 'evt_other' }), await invoke(event, event, 'whsec_wrong'),
      await invoke({ ...event, livemode: true }), await invoke({ ...event, account: 'acct_foreign' })]) expect(response.sendStatus).toHaveBeenCalledWith(400);
    expect(admitBillingEvent).not.toHaveBeenCalled();
  });
  it('returns retryable failure when durable admission fails', async () => {
    vi.mocked(admitBillingEvent).mockRejectedValueOnce(new Error('private database failure'));
    expect((await invoke(event)).sendStatus).toHaveBeenCalledWith(503);
  });
  it.each(['invoice.upcoming', 'invoice.deleted'])('acknowledges %s without scheduling an impossible invoice retrieval', async type => {
    const response = await invoke({ ...event, type, data: { object: { customer: 'cus_synthetic' } } });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(admitBillingEvent).not.toHaveBeenCalled();
  });
});
