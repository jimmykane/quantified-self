import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROJECT_ID = 'quantified-self-io';
const SNAPSHOT_VERSION = 1;
const DEFAULT_OUTPUT_PATH = 'tmp/public-pricing-snapshot.json';
const FIRESTORE_DOCUMENTS_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const PRODUCTS_URL = `${FIRESTORE_DOCUMENTS_URL}/products`;
const RECURRING_INTERVALS = new Set(['day', 'week', 'month', 'year']);
const PRICE_TYPES = new Set(['one_time', 'recurring']);

/**
 * Fetches only the public pricing fields needed to prerender /pricing. The
 * Firestore rules deliberately allow signed-out reads for this catalog, so no
 * credential or service account is needed at build time.
 */
export async function fetchPublicPricingProducts(fetchImpl = fetch) {
  const productDocuments = await listFirestoreDocuments(PRODUCTS_URL, fetchImpl);
  const products = await Promise.all(productDocuments.map(async document => {
    const product = sanitizeProduct(document);
    if (!product.active) {
      return null;
    }

    const priceDocuments = await listFirestoreDocuments(
      `${FIRESTORE_DOCUMENTS_URL}/products/${encodeURIComponent(product.id)}/prices`,
      fetchImpl,
    );
    const prices = priceDocuments
      .map(sanitizePrice)
      .filter(price => price.active);

    return { ...product, prices };
  }));

  return products.filter(product => product !== null);
}

export async function listFirestoreDocuments(baseUrl, fetchImpl) {
  const documents = [];
  let pageToken = null;

  do {
    const url = new URL(baseUrl);
    url.searchParams.set('pageSize', '100');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Public pricing catalog request failed with HTTP ${response.status}.`);
    }

    const page = await response.json();
    if (!isRecord(page)) {
      throw new Error('Public pricing catalog response has an invalid shape.');
    }

    if (page.documents !== undefined && !Array.isArray(page.documents)) {
      throw new Error('Public pricing catalog documents are invalid.');
    }
    documents.push(...(page.documents ?? []));
    pageToken = typeof page.nextPageToken === 'string' && page.nextPageToken.length > 0
      ? page.nextPageToken
      : null;
  } while (pageToken);

  return documents;
}

export function buildPublicPricingSnapshot(products, generatedAt = new Date().toISOString()) {
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('Public pricing catalog has no active products.');
  }
  if (!products.some(product => productHasPaidRole(product, 'basic'))
    || !products.some(product => productHasPaidRole(product, 'pro'))) {
    throw new Error('Public pricing catalog is missing an active Basic or Pro recurring price.');
  }

  return {
    version: SNAPSHOT_VERSION,
    generatedAt,
    products,
  };
}

export function sanitizeProduct(document) {
  const fields = firestoreFields(document);
  return {
    id: firestoreDocumentId(document),
    active: fields.active === true,
    name: stringOrEmpty(fields.name),
    description: stringOrNull(fields.description),
    role: stringOrNull(fields.role),
    images: stringArray(fields.images),
    metadata: publicProductMetadata(fields.metadata),
  };
}

export function sanitizePrice(document) {
  const fields = firestoreFields(document);
  const recurring = sanitizeRecurring(fields.recurring);
  const type = PRICE_TYPES.has(fields.type) ? fields.type : 'one_time';
  const interval = RECURRING_INTERVALS.has(fields.interval) ? fields.interval : null;

  return {
    id: firestoreDocumentId(document),
    active: fields.active === true,
    currency: stringOrEmpty(fields.currency),
    unit_amount: integerOrNull(fields.unit_amount),
    description: stringOrNull(fields.description),
    type,
    interval,
    interval_count: positiveIntegerOrNull(fields.interval_count),
    trial_period_days: positiveIntegerOrNull(fields.trial_period_days),
    metadata: publicPriceMetadata(fields.metadata),
    recurring,
  };
}

export function decodeFirestoreValue(value) {
  if (!isRecord(value)) {
    return undefined;
  }
  if ('nullValue' in value) {
    return null;
  }
  if (typeof value.booleanValue === 'boolean') {
    return value.booleanValue;
  }
  if (typeof value.integerValue === 'string' || typeof value.integerValue === 'number') {
    const parsed = Number(value.integerValue);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  if (typeof value.doubleValue === 'number') {
    return Number.isFinite(value.doubleValue) ? value.doubleValue : undefined;
  }
  if (typeof value.stringValue === 'string') {
    return value.stringValue;
  }
  if (isRecord(value.mapValue)) {
    return decodeFirestoreFields(value.mapValue.fields);
  }
  if (isRecord(value.arrayValue)) {
    const values = value.arrayValue.values;
    return Array.isArray(values) ? values.map(decodeFirestoreValue).filter(item => item !== undefined) : [];
  }

  return undefined;
}

function firestoreFields(document) {
  if (!isRecord(document) || !isRecord(document.fields)) {
    throw new Error('Public pricing catalog document is invalid.');
  }
  return decodeFirestoreFields(document.fields);
}

function decodeFirestoreFields(fields) {
  if (!isRecord(fields)) {
    return {};
  }
  return Object.fromEntries(Object.entries(fields)
    .map(([key, value]) => [key, decodeFirestoreValue(value)])
    .filter(([, value]) => value !== undefined));
}

function firestoreDocumentId(document) {
  if (!isRecord(document) || typeof document.name !== 'string') {
    throw new Error('Public pricing catalog document does not have an ID.');
  }
  const id = document.name.split('/').at(-1);
  if (!id) {
    throw new Error('Public pricing catalog document has an invalid ID.');
  }
  return id;
}

function publicProductMetadata(metadata) {
  return pickStringValues(metadata, ['firebaseRole', 'role']);
}

function publicPriceMetadata(metadata) {
  return pickStringValues(metadata, ['firebaseRole', 'role', 'trial_days']);
}

function pickStringValues(value, allowedKeys) {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(allowedKeys
    .filter(key => typeof value[key] === 'string')
    .map(key => [key, value[key]]));
}

function sanitizeRecurring(value) {
  if (!isRecord(value) || !RECURRING_INTERVALS.has(value.interval)) {
    return null;
  }
  const intervalCount = positiveIntegerOrNull(value.interval_count);
  return intervalCount === null
    ? { interval: value.interval }
    : { interval: value.interval, interval_count: intervalCount };
}

function productHasPaidRole(product, role) {
  if (product.active !== true) {
    return false;
  }

  const paidRecurringPrices = (product.prices ?? []).filter(isActivePaidRecurringPrice);
  const pricesWithExplicitRoles = paidRecurringPrices.filter(price => getPriceRole(price) !== null);

  // This mirrors transformProductsForPricing(): when any price defines a
  // Basic/Pro role, it splits the product exclusively by those price roles.
  if (pricesWithExplicitRoles.length > 0) {
    return pricesWithExplicitRoles.some(price => (
      getPriceRole(price) === role && isRenderablePaidRecurringPrice(price)
    ));
  }

  const productRole = getProductRole(product);
  return productRole === role && paidRecurringPrices.some(isRenderablePaidRecurringPrice);
}

/**
 * Keep the build-time catalog contract aligned with the public pricing
 * renderer. A price that cannot produce a visible paid offer must not make a
 * snapshot appear valid.
 */
function isRenderablePaidRecurringPrice(price) {
  const currency = typeof price.currency === 'string' ? price.currency.trim().toUpperCase() : '';

  return isActivePaidRecurringPrice(price)
    && typeof price.unit_amount === 'number'
    && Number.isSafeInteger(price.unit_amount)
    && price.unit_amount > 0
    && /^[A-Z]{3}$/.test(currency);
}

function isActivePaidRecurringPrice(price) {
  const interval = price.recurring?.interval ?? price.interval;

  return price.active === true
    && price.type === 'recurring'
    && (interval === 'month' || interval === 'year');
}

function getProductRole(product) {
  return normalizePaidRole(product.role ?? product.metadata?.role ?? product.metadata?.firebaseRole);
}

function getPriceRole(price) {
  return normalizePaidRole(price.metadata?.firebaseRole);
}

function normalizePaidRole(value) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : null;
  return normalized === 'basic' || normalized === 'pro' ? normalized : null;
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value : '';
}

function stringOrNull(value) {
  return typeof value === 'string' ? value : null;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}

function integerOrNull(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function positiveIntegerOrNull(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function main({ fetchImpl = fetch, outputPath = DEFAULT_OUTPUT_PATH } = {}) {
  const products = await fetchPublicPricingProducts(fetchImpl);
  const snapshot = buildPublicPricingSnapshot(products);
  const absoluteOutputPath = resolve(process.cwd(), outputPath);
  await mkdir(dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return snapshot;
}

const executedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (executedPath === import.meta.url) {
  main().then(snapshot => {
    console.log(`Generated public pricing snapshot for ${snapshot.products.length} active products.`);
  }).catch(error => {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    console.error(`Could not generate the public pricing snapshot: ${message}`);
    process.exitCode = 1;
  });
}
