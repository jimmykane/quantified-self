import { deleteApp, initializeApp } from 'firebase/app';
import { XhrIo } from '@firebase/webchannel-wrapper/webchannel-blob';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Exercise the browser transport: Firebase's Node entry point uses fetch and
// cannot reproduce the XhrIo callback/pending-promise bug seen in Sentry.
import {
  collection, getCountFromServer, initializeFirestore, query, terminate, where,
} from '../../../node_modules/@firebase/firestore/dist/index.esm.js';
import './firestore';
import { installFirestoreHttpResponseGuard } from './firestore-http-response-guard';

interface MockResponse { status: number; body: string; readError?: Error }
const responses: MockResponse[] = [];
const requests: Array<{ url: string; body: string }> = [];
const escapedErrors: unknown[] = [];

class MockXMLHttpRequest {
  readyState = 0;
  status = 0;
  statusText = '';
  responseText = '';
  withCredentials = false;
  onreadystatechange: (() => void) | null = null;
  private url = '';

  open(_method: string, url: string): void { this.url = url; this.readyState = 1; }
  setRequestHeader(): void { }
  getResponseHeader(): null { return null; }
  getAllResponseHeaders(): string { return ''; }
  abort(): void { this.readyState = 0; }
  send(body: string): void {
    requests.push({ url: this.url, body });
    const response = responses.shift();
    if (!response) throw new Error('Unexpected SDK request');
    queueMicrotask(() => {
      this.status = response.status;
      this.statusText = response.status === 504 ? 'Gateway Timeout' : '';
      this.responseText = response.body;
      if (response.readError) {
        Object.defineProperty(this, 'responseText', { get: () => { throw response.readError; } });
      }
      this.readyState = 4;
      try {
        this.onreadystatechange?.();
      } catch (error) {
        // Native XHR would report this as a global browser error. Recording it
        // lets the regression detect that leak without hiding a pending RPC.
        escapedErrors.push(error);
      }
    });
  }
}

describe('Firestore browser HTTP response guard', () => {
  let app: ReturnType<typeof initializeApp>;
  let firestore: ReturnType<typeof initializeFirestore>;
  let appSequence = 0;

  beforeEach(() => {
    responses.length = 0;
    requests.length = 0;
    escapedErrors.length = 0;
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
    // Silence expected SDK warnings locally without changing its persistent
    // log level for subsequent suites sharing the SDK module.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    app = initializeApp({ projectId: 'synthetic-http-test', apiKey: 'fake-api-key' }, `http-test-${++appSequence}`);
    firestore = initializeFirestore(app, { host: '127.0.0.1:8181', ssl: false });
  });

  afterEach(async () => {
    try {
      try {
        await terminate(firestore);
      } finally {
        await deleteApp(app);
      }
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it.each([
    { status: 504, body: '' },
    { status: 504, body: '<html>Gateway Timeout</html>' },
    { status: 503, body: 'Service unavailable' },
    { status: 400, body: '{"error":' },
  ])('rejects malformed HTTP $status responses without a global error or stalled count', async response => {
    responses.push(response);
    await expect(getCountFromServer(collection(firestore, 'events'))).rejects.toMatchObject({
      code: 'unknown', message: `Server responded with status ${response.status}`,
    });
    expect(escapedErrors).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it('preserves successful counts and query filters', async () => {
    responses.push({ status: 200, body: JSON.stringify([
      { result: { aggregateFields: { aggregate_0: { integerValue: '7' } } } },
    ]) });
    const snapshot = await getCountFromServer(query(collection(firestore, 'events'), where('sport', '==', 'Running')));
    expect(snapshot.data().count).toBe(7);
    expect(escapedErrors).toEqual([]);
    expect(JSON.parse(requests[0].body).structuredAggregationQuery.structuredQuery.where).toEqual({
      fieldFilter: { field: { fieldPath: 'sport' }, op: 'EQUAL', value: { stringValue: 'Running' } },
    });
  });

  it.each([false, true])('preserves structured permission errors (array response: %s)', async arrayResponse => {
    const error = { error: { status: 'PERMISSION_DENIED', message: 'Access denied' } };
    responses.push({ status: 403, body: JSON.stringify(arrayResponse ? [error] : error) });
    await expect(getCountFromServer(collection(firestore, 'events'))).rejects.toMatchObject({
      code: 'permission-denied', message: 'Access denied',
    });
    expect(escapedErrors).toEqual([]);
  });

  it('preserves structured authentication errors', async () => {
    responses.push({ status: 401, body: JSON.stringify({
      error: { status: 'UNAUTHENTICATED', message: 'Credentials expired' },
    }) });
    await expect(getCountFromServer(collection(firestore, 'events'))).rejects.toMatchObject({
      code: 'unauthenticated', message: 'Credentials expired',
    });
    expect(escapedErrors).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it('preserves connection failures with no HTTP response', async () => {
    responses.push({ status: 0, body: '' });
    await expect(getCountFromServer(collection(firestore, 'events'))).rejects.toMatchObject({
      code: 'unavailable', message: 'Connection failed.',
    });
    expect(escapedErrors).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it('allows a fresh count after a gateway failure', async () => {
    responses.push({ status: 504, body: '' });
    await expect(getCountFromServer(collection(firestore, 'events'))).rejects.toMatchObject({ code: 'unknown' });
    responses.push({ status: 200, body: JSON.stringify([
      { result: { aggregateFields: { aggregate_0: { integerValue: '0' } } } },
    ]) });
    expect((await getCountFromServer(collection(firestore, 'events'))).data().count).toBe(0);
    expect(escapedErrors).toEqual([]);
    expect(requests).toHaveLength(2);
  });

  it('does not hide malformed successful responses', async () => {
    responses.push({ status: 200, body: '' });
    // This remains a genuine malformed-success bug, not an HTTP error fallback.
    const pending = getCountFromServer(collection(firestore, 'events'));
    void pending.catch(() => {});
    await vi.waitFor(() => expect(escapedErrors).toHaveLength(1));
    expect(escapedErrors[0]).toBeInstanceOf(SyntaxError);
  });

  it('preserves non-JSON exceptions while reading an HTTP error response', async () => {
    const error = new TypeError('Response text could not be read');
    responses.push({ status: 504, body: '', readError: error });
    const pending = getCountFromServer(collection(firestore, 'events'));
    void pending.catch(() => {});
    await vi.waitFor(() => expect(escapedErrors).toEqual([error]));
  });

  it('installs once without stacking parser wrappers', () => {
    const parser = XhrIo.prototype.getResponseJson;
    installFirestoreHttpResponseGuard();
    installFirestoreHttpResponseGuard();
    expect(XhrIo.prototype.getResponseJson).toBe(parser);
  });
});
