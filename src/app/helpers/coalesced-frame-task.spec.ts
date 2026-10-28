import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoalescedFrameTask } from './coalesced-frame-task';

describe('CoalescedFrameTask', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('combines bursts using the latest state and accepts another update next frame', () => {
    let frame!: FrameRequestCallback;
    const request = vi.fn(callback => { frame = callback; return 1; });
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    let state = 0;
    const task = vi.fn(() => state);
    const queue = new CoalescedFrameTask(task);
    for (state = 0; state < 20; state++) queue.request();
    expect(task).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
    frame(0);
    expect(task).toHaveReturnedWith(20);
    queue.request(); frame(16);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('cancels stale callbacks and refuses work after disposal', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn(callback => frames.push(callback)));
    const cancel = vi.fn(); vi.stubGlobal('cancelAnimationFrame', cancel);
    const task = vi.fn(); const queue = new CoalescedFrameTask(task);
    queue.request(); queue.cancel(); frames[0](0);
    expect(task).not.toHaveBeenCalled();
    queue.request(); queue.dispose(); frames[1](16); queue.request();
    expect(task).not.toHaveBeenCalled();
    expect(frames).toHaveLength(2);
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('coalesces and cancels with no animation frame API', () => {
    vi.useFakeTimers(); vi.stubGlobal('requestAnimationFrame', undefined);
    const task = vi.fn(); const queue = new CoalescedFrameTask(task);
    queue.request(); queue.request(); vi.runOnlyPendingTimers();
    expect(task).toHaveBeenCalledOnce();
    queue.request(); queue.dispose(); vi.runOnlyPendingTimers();
    expect(task).toHaveBeenCalledOnce();
  });
});
