import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../request-helper', () => ({
  get: vi.fn(),
  ResponseBodyTooLargeError: class ResponseBodyTooLargeError extends Error {
    readonly name = 'ResponseBodyTooLargeError';

    constructor(public readonly maxResponseBytes: number, public readonly receivedBytes: number) {
      super('Response body exceeded its configured byte limit.');
    }
  },
}));

import * as requestPromise from '../request-helper';
import {
  COROSFITDetailAuthError,
  PermanentCOROSFITDetailError,
  recoverCOROSFITFileURL,
  RetryableCOROSFITDetailError,
} from './workout-detail';

const token = { accessToken: 'access-token' } as never;
const rootItem = {
  id: 'queue-id',
  dateCreated: 1,
  dispatchedToCloudTask: null,
  processed: false,
  retryCount: 0,
  openId: 'open-id',
  workoutID: '418173315956375553',
  mode: 8,
  subMode: 1,
  detailMode: 8,
  detailSubMode: 1,
  componentKey: 'root',
} as const;

describe('recoverCOROSFITFileURL', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a fresh URL for a matching regular workout', async () => {
    vi.mocked(requestPromise.get).mockResolvedValue(JSON.stringify({
      result: '0000',
      message: 'OK',
      data: {
        labelId: '418173315956375553',
        mode: 8,
        subMode: 1,
        fitUrl: 'https://oss.coros.com/fit/fresh.fit?signature=secret',
      },
    }));

    await expect(recoverCOROSFITFileURL(token, rootItem)).resolves
      .toBe('https://oss.coros.com/fit/fresh.fit?signature=secret');
    expect(requestPromise.get).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('/v2/coros/sport/detail/fit?'),
      timeout: 30_000,
      maxResponseBytes: 1_048_576,
    }));
    const requestedUrl = vi.mocked(requestPromise.get).mock.calls[0][0].url as string;
    expect(requestedUrl).toContain('token=access-token');
    expect(requestedUrl).toContain('labelId=418173315956375553');
    expect(requestedUrl).toContain('mode=8&subMode=1');
  });

  it('uses the parent mode and selects the verified multisport child by index', async () => {
    vi.mocked(requestPromise.get).mockResolvedValue(
      '{"result":"0000","data":{"labelId":418173315956375553,"mode":13,"subMode":1,"triathlonItemList":['
      + '{"mode":10,"subMode":1,"fitUrl":"https://oss.coros.com/fit/swim.fit"},'
      + '{"mode":9,"subMode":1,"fitUrl":"https://oss.coros.com/fit/bike.fit"}]}}',
    );

    await expect(recoverCOROSFITFileURL(token, {
      ...rootItem,
      mode: 9,
      subMode: 1,
      detailMode: 13,
      detailSubMode: 1,
      componentIndex: 1,
      componentKey: 'component:1:9:1',
    })).resolves.toBe('https://oss.coros.com/fit/bike.fit');
    const requestedUrl = vi.mocked(requestPromise.get).mock.calls[0][0].url as string;
    expect(requestedUrl).toContain('mode=13&subMode=1');
  });

  it('rejects mismatched workout and multisport identities', async () => {
    vi.mocked(requestPromise.get).mockResolvedValueOnce(JSON.stringify({
      result: '0000',
      data: { labelId: '418173315956375554', fitUrl: 'https://oss.coros.com/fit/wrong.fit' },
    }));
    await expect(recoverCOROSFITFileURL(token, rootItem)).rejects
      .toMatchObject({ reason: 'workout_id_mismatch' });

    vi.mocked(requestPromise.get).mockResolvedValueOnce(JSON.stringify({
      result: '0000',
      data: {
        labelId: rootItem.workoutID,
        mode: 8,
        subMode: 1,
        triathlonItemList: [{ mode: 10, subMode: 1, fitUrl: 'https://oss.coros.com/fit/wrong.fit' }],
      },
    }));
    await expect(recoverCOROSFITFileURL(token, {
      ...rootItem,
      mode: 9,
      componentIndex: 0,
      componentKey: 'component:0:9:1',
    })).rejects.toMatchObject({ reason: 'multisport_component_mismatch' });

    vi.mocked(requestPromise.get).mockResolvedValueOnce(JSON.stringify({
      result: '0000',
      data: {
        labelId: rootItem.workoutID,
        mode: 9,
        subMode: 1,
        fitUrl: 'https://oss.coros.com/fit/wrong-parent.fit',
      },
    }));
    await expect(recoverCOROSFITFileURL(token, rootItem)).rejects
      .toMatchObject({ reason: 'parent_workout_type_mismatch' });
  });

  it('rejects malformed or internally inconsistent multisport component identity', async () => {
    const matchingResponse = JSON.stringify({
      result: '0000',
      data: {
        labelId: rootItem.workoutID,
        mode: 13,
        subMode: 1,
        triathlonItemList: [{
          mode: 9,
          subMode: 1,
          fitUrl: 'https://oss.coros.com/fit/bike.fit',
        }],
      },
    });
    vi.mocked(requestPromise.get).mockResolvedValue(matchingResponse);

    await expect(recoverCOROSFITFileURL(token, {
      ...rootItem,
      mode: 9,
      detailMode: 13,
      componentIndex: 0.5,
      componentKey: 'component:0.5:9:1',
    })).rejects.toMatchObject({ reason: 'invalid_multisport_component_identity' });

    await expect(recoverCOROSFITFileURL(token, {
      ...rootItem,
      mode: 9,
      detailMode: 13,
      componentIndex: 0,
      componentKey: 'component:1:9:1',
    })).rejects.toMatchObject({ reason: 'invalid_multisport_component_identity' });
  });

  it('classifies no-data, authentication, identity, and permanent provider errors', async () => {
    vi.mocked(requestPromise.get).mockResolvedValueOnce('{"result":"5016","message":"No data found"}');
    await expect(recoverCOROSFITFileURL(token, rootItem)).rejects.toBeInstanceOf(RetryableCOROSFITDetailError);

    vi.mocked(requestPromise.get).mockResolvedValueOnce('{"result":"5006","message":"Invalid authorization"}');
    await expect(recoverCOROSFITFileURL(token, rootItem)).rejects.toBeInstanceOf(COROSFITDetailAuthError);

    vi.mocked(requestPromise.get).mockResolvedValueOnce('{"result":"5010","message":"Invalid openId"}');
    await expect(recoverCOROSFITFileURL(token, rootItem)).rejects
      .toMatchObject({ reason: 'invalid_open_id', providerCode: '5010' });

    vi.mocked(requestPromise.get).mockResolvedValueOnce('{"result":"5001","message":"Bad request"}');
    await expect(recoverCOROSFITFileURL(token, rootItem)).rejects.toBeInstanceOf(PermanentCOROSFITDetailError);
  });

  it('rejects a contradictory success code and failure message', async () => {
    vi.mocked(requestPromise.get).mockResolvedValueOnce(JSON.stringify({
      result: '0000',
      message: 'Invalid authorization',
      data: {
        labelId: rootItem.workoutID,
        mode: rootItem.mode,
        subMode: rootItem.subMode,
        fitUrl: 'https://oss.coros.com/fit/untrusted.fit',
      },
    }));

    await expect(recoverCOROSFITFileURL(token, rootItem)).rejects.toMatchObject({
      reason: 'contradictory_success_response',
      providerCode: '0000',
    });
  });

  it('classifies transient HTTP/network failures without exposing provider bodies', async () => {
    vi.mocked(requestPromise.get).mockRejectedValueOnce(Object.assign(new Error('provider URL with token secret'), {
      statusCode: 503,
    }));
    const transient = recoverCOROSFITFileURL(token, rootItem);
    await expect(transient).rejects.toBeInstanceOf(RetryableCOROSFITDetailError);
    await expect(transient).rejects.not.toThrow('secret');

    vi.mocked(requestPromise.get).mockRejectedValueOnce(Object.assign(new Error('forbidden'), { statusCode: 401 }));
    await expect(recoverCOROSFITFileURL(token, rootItem)).rejects.toBeInstanceOf(COROSFITDetailAuthError);
  });

  it('permanently rejects an oversized detail response without retrying it', async () => {
    vi.mocked(requestPromise.get).mockRejectedValueOnce(
      new requestPromise.ResponseBodyTooLargeError(1_048_576, 1_048_577),
    );

    await expect(recoverCOROSFITFileURL(token, rootItem)).rejects.toMatchObject({
      name: 'PermanentCOROSFITDetailError',
      reason: 'detail_response_too_large',
    });
  });

  it('rejects missing metadata before making a provider request', async () => {
    await expect(recoverCOROSFITFileURL(token, {
      ...rootItem,
      mode: undefined,
      detailMode: undefined,
    })).rejects.toMatchObject({ reason: 'invalid_detail_request_identity' });
    expect(requestPromise.get).not.toHaveBeenCalled();
  });
});
