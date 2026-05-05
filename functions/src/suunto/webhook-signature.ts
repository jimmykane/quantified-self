import * as crypto from 'crypto';

export function verifySuuntoWebhookSignature(rawBody: Buffer | undefined, signature: string | null | undefined): boolean {
  const secret = process.env.SUUNTOAPP_NOTIFICATION_SECRET;
  const trimmedSignature = typeof signature === 'string' ? signature.trim() : '';
  if (!secret || !rawBody || !trimmedSignature || !/^[a-fA-F0-9]+$/.test(trimmedSignature)) {
    return false;
  }

  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const expected = Buffer.from(digest, 'hex');
  const actual = Buffer.from(trimmedSignature, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
