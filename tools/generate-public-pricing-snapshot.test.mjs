import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPublicPricingSnapshot,
  decodeFirestoreValue,
  fetchPublicPricingProducts,
  sanitizePrice,
  sanitizeProduct,
} from './generate-public-pricing-snapshot.mjs';

function firestoreDocument(id, fields) {
  return {
    name: `projects/quantified-self-io/databases/(default)/documents/products/${id}`,
    fields,
  };
}

function stringValue(value) {
  return { stringValue: value };
}

function integerValue(value) {
  return { integerValue: String(value) };
}

function priceDocument(id, role) {
  return firestoreDocument(id, {
    active: { booleanValue: true },
    currency: stringValue('usd'),
    unit_amount: integerValue(500),
    type: stringValue('recurring'),
    interval: stringValue('month'),
    metadata: {
      mapValue: {
        fields: {
          firebaseRole: stringValue(role),
          trial_days: stringValue('30'),
          internal_note: stringValue('must not be rendered'),
        },
      },
    },
  });
}

test('decodes Firestore document values without preserving unsupported types', () => {
  assert.deepEqual(decodeFirestoreValue({
    mapValue: {
      fields: {
        name: stringValue('Basic'),
        amount: integerValue(500),
        tags: { arrayValue: { values: [stringValue('membership')] } },
      },
    },
  }), {
    name: 'Basic',
    amount: 500,
    tags: ['membership'],
  });
  assert.equal(decodeFirestoreValue({ timestampValue: '2026-09-04T00:00:00Z' }), undefined);
});

test('sanitizes pricing documents to the exact public rendering fields', () => {
  const product = sanitizeProduct(firestoreDocument('membership', {
    active: { booleanValue: true },
    name: stringValue('Membership'),
    metadata: {
      mapValue: {
        fields: {
          firebaseRole: stringValue('basic'),
          api_secret: stringValue('must not be rendered'),
        },
      },
    },
  }));
  const price = sanitizePrice(priceDocument('price_basic_monthly', 'basic'));

  assert.deepEqual(product.metadata, { firebaseRole: 'basic' });
  assert.deepEqual(price.metadata, { firebaseRole: 'basic', trial_days: '30' });
  assert.equal('api_secret' in product.metadata, false);
  assert.equal('internal_note' in price.metadata, false);
});

test('rejects a snapshot that cannot render both paid public memberships', () => {
  assert.throws(
    () => buildPublicPricingSnapshot([{ active: true, prices: [] }]),
    /Basic or Pro recurring price/,
  );
});

test('rejects inactive or non-renderable paid prices instead of publishing an empty paid catalog', () => {
  const basicPrice = {
    active: true,
    type: 'recurring',
    interval: 'month',
    currency: 'usd',
    unit_amount: 500,
    metadata: { firebaseRole: 'basic' },
  };
  const proPrice = {
    ...basicPrice,
    metadata: { firebaseRole: 'pro' },
  };

  assert.throws(
    () => buildPublicPricingSnapshot([
      { active: false, prices: [basicPrice] },
      { active: true, prices: [proPrice] },
    ]),
    /Basic or Pro recurring price/,
  );
  assert.throws(
    () => buildPublicPricingSnapshot([
      { active: true, prices: [{ ...basicPrice, unit_amount: 0 }] },
      { active: true, prices: [proPrice] },
    ]),
    /Basic or Pro recurring price/,
  );
  assert.throws(
    () => buildPublicPricingSnapshot([
      { active: true, prices: [{ ...basicPrice, currency: 'invalid' }] },
      { active: true, prices: [proPrice] },
    ]),
    /Basic or Pro recurring price/,
  );
});

test('uses price-level roles with the same precedence as the rendered catalog', () => {
  const basicPrice = {
    active: true,
    type: 'recurring',
    interval: 'month',
    currency: 'usd',
    unit_amount: 500,
    metadata: { firebaseRole: 'basic' },
  };

  assert.throws(
    () => buildPublicPricingSnapshot([{ active: true, role: 'pro', prices: [basicPrice] }]),
    /Basic or Pro recurring price/,
  );
  assert.doesNotThrow(() => buildPublicPricingSnapshot([
    { active: true, role: 'pro', prices: [basicPrice] },
    {
      active: true,
      prices: [{
        ...basicPrice,
        metadata: { firebaseRole: 'pro' },
      }],
    },
  ]));
});

test('follows pagination and fetches active nested prices from the public catalog', async () => {
  const basicProduct = firestoreDocument('membership', {
    active: { booleanValue: true },
    name: stringValue('Membership'),
  });
  const proProduct = firestoreDocument('membership-pro', {
    active: { booleanValue: true },
    name: stringValue('Membership Pro'),
  });
  const calls = [];
  const fetchImpl = async url => {
    const requestUrl = String(url);
    calls.push(requestUrl);
    if (requestUrl.includes('/products?') && !requestUrl.includes('pageToken=')) {
      return jsonResponse({ documents: [basicProduct], nextPageToken: 'next' });
    }
    if (requestUrl.includes('/products?') && requestUrl.includes('pageToken=next')) {
      return jsonResponse({ documents: [proProduct] });
    }
    if (requestUrl.includes('/products/membership/prices')) {
      return jsonResponse({ documents: [priceDocument('price_basic_monthly', 'basic')] });
    }
    if (requestUrl.includes('/products/membership-pro/prices')) {
      return jsonResponse({ documents: [priceDocument('price_pro_monthly', 'pro')] });
    }
    throw new Error(`Unexpected request ${requestUrl}`);
  };

  const products = await fetchPublicPricingProducts(fetchImpl);

  assert.equal(products.length, 2);
  assert.equal(calls.length, 4);
  assert.doesNotThrow(() => buildPublicPricingSnapshot(products, '2026-09-04T00:00:00.000Z'));
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}
