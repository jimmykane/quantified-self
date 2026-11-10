import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerrainOptions } from './onboarding-terrain.types';
import { createTerrainRenderer } from './onboarding-terrain.renderer';

const graphics = vi.hoisted(() => ({
  render: vi.fn(),
  dispose: vi.fn(),
  size: vi.fn()
}));
vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  return {
    ...three,
    WebGLRenderer: class {
      setPixelRatio() {}
      setClearColor() {}
      setSize = graphics.size;
      render = graphics.render;
      dispose = graphics.dispose;
    }
  };
});

describe('onboarding terrain renderer lifecycle', () => {
  let stage: HTMLElement;
  let canvas: HTMLCanvasElement;
  let frames: Map<number, FrameRequestCallback>;
  let resize: ResizeObserverCallback;
  let intersect: IntersectionObserverCallback;
  let hidden: boolean;
  let nextFrame: number;
  let frameTime: number;
  const disconnectResize = vi.fn(),
    disconnectIntersection = vi.fn();
  let options: TerrainOptions;
  const controllers: ReturnType<typeof createTerrainRenderer>[] = [];
  beforeEach(() => {
    vi.clearAllMocks();
    frames = new Map();
    hidden = false;
    nextFrame = 0;
    frameTime = 0;
    stage = document.createElement('div');
    canvas = document.createElement('canvas');
    stage.append(canvas);
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 500,
      height: 800
    } as DOMRect);
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        disconnect = disconnectResize;
      }
    );
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersect = callback;
        }
        observe() {}
        disconnect = disconnectIntersection;
      }
    );
    options = {
      dark: false,
      reducedMotion: true,
      resizeObserver: true,
      intersectionObserver: true,
      onReady: vi.fn(),
      onUnavailable: vi.fn()
    };
  });
  afterEach(() => {
    controllers.splice(0).forEach((controller) => controller.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  function create() {
    const controller = createTerrainRenderer(canvas, stage, options);
    controllers.push(controller);
    return controller;
  }
  function frame(time = frameTime + 1000 / 60) {
    frameTime = time;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(time));
  }
  function intersection(visible: boolean) {
    intersect(
      [{ isIntersecting: visible } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
  }

  it('renders a still frame, repaints theme and resize changes, then sleeps', () => {
    const controller = create();
    frame();
    expect(graphics.render).toHaveBeenCalledTimes(1);
    expect(options.onReady).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    controller.setTheme(true);
    frame();
    expect(graphics.render).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(0);
    resize([], {} as ResizeObserver);
    frame();
    expect(graphics.size).toHaveBeenCalledWith(500, 800, false);
    expect(graphics.render).toHaveBeenCalledTimes(3);
  });

  it('defers pending paints in a hidden tab and outside the viewport', () => {
    const controller = create();
    frame();
    controller.setTheme(true);
    expect(frames.size).toBe(1);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(0);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(1);
    intersection(false);
    expect(frames.size).toBe(0);
    intersection(true);
    expect(frames.size).toBe(1);
  });

  function move(pointerType = 'mouse') {
    stage.dispatchEvent(Object.assign(new Event('pointermove'), {
      pointerType, clientX: 450, clientY: 700
    }));
  }

  it('layers pointer parallax over the drift and returns to the same orbit after leaving', () => {
    options.reducedMotion = false;
    create();
    frame();
    const camera = graphics.render.mock.lastCall![1];
    frame(frameTime + 4500);
    const initial = camera.position.clone();
    const initialTime = frameTime;
    move();
    frame();
    expect(camera.position.y - initial.y).toBeGreaterThan(0.01);
    for (let i = 0; i < 200; i++) frame();
    stage.dispatchEvent(new Event('pointerleave'));
    for (let i = 0; i < 200; i++) frame();
    frame(initialTime + 24000);
    expect(camera.position.distanceTo(initial)).toBeLessThan(0.001);
    expect(frames.size).toBe(1);
  });

  it('ignores touch parallax and resets the camera when reduced motion is enabled', () => {
    const controller = create();
    frame();
    const camera = graphics.render.mock.lastCall![1];
    const still = camera.position.clone();
    controller.setReducedMotion(false);
    frame();
    frame(frameTime + 5000);
    const initial = camera.position.clone();
    move('touch');
    frame(frameTime + 24000);
    expect(camera.position.distanceTo(initial)).toBeLessThan(0.001);
    move();
    frame();
    expect(camera.position.y - initial.y).toBeGreaterThan(0.01);
    controller.setReducedMotion(true);
    frame();
    expect(camera.position.equals(still)).toBe(true);
    expect(frames.size).toBe(0);
    move();
    expect(frames.size).toBe(0);
  });

  it('continues a bounded, seamless drift after the entry glide', () => {
    options.reducedMotion = false;
    create();
    frame();
    const camera = graphics.render.mock.lastCall![1];
    const start = camera.position.clone();
    frame(frameTime + 4500);
    const afterEntry = camera.position.clone();
    expect(afterEntry.x).toBeGreaterThan(start.x);
    frame(frameTime + 1500);
    expect(camera.position.x).toBeGreaterThan(afterEntry.x);
    frame(frameTime + 12000);
    expect(camera.position.x).toBeLessThan(afterEntry.x);
    frame(frameTime + 10500);
    expect(camera.position.distanceTo(afterEntry)).toBeLessThan(0.001);
    expect(frames.size).toBe(1);
    expect(options.onReady).toHaveBeenCalledTimes(1);
  });

  it('limits passive rendering to thirty paints per second', () => {
    options.reducedMotion = false;
    create();
    frame();
    const before = graphics.render.mock.calls.length;
    for (let i = 0; i < 120; i++) frame();
    const paints = graphics.render.mock.calls.length - before;
    expect(paints).toBeGreaterThan(50);
    expect(paints).toBeLessThanOrEqual(61);
  });

  it('replays a completed glide when entering the intro, and still honors reduced motion', () => {
    options.reducedMotion = false;
    const controller = create();
    frame();
    const camera = graphics.render.mock.lastCall![1];
    const start = camera.position.clone();
    frame(frameTime + 4500);
    const end = camera.position.clone();
    controller.replayEntry();
    frame();
    expect(camera.position.equals(start)).toBe(true);
    frame(frameTime + 4500);
    expect(camera.position.equals(end)).toBe(true);
    expect(frames.size).toBe(1);
    controller.setReducedMotion(true);
    frame();
    const still = camera.position.clone();
    controller.replayEntry();
    expect(frames.size).toBe(0);
    expect(camera.position.equals(still)).toBe(true);
  });

  it.each([1000, 10000])('pauses motion at %i ms offscreen and in hidden tabs without a jump on return', (elapsed) => {
    options.reducedMotion = false;
    create();
    frame();
    frame(frameTime + elapsed);
    const camera = graphics.render.mock.lastCall![1];
    const before = camera.position.clone();
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(0);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    frame(frameTime + 10000);
    expect(camera.position.equals(before)).toBe(true);
    intersection(false);
    expect(frames.size).toBe(0);
    intersection(true);
    frame(frameTime + 10000);
    expect(camera.position.equals(before)).toBe(true);
    frame(frameTime + 40);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0);
  });

  it('centers and stops for reduced motion, then resumes drift without replaying the entry', () => {
    options.reducedMotion = false;
    const controller = create();
    frame();
    controller.setReducedMotion(true);
    frame();
    const settled = graphics.render.mock.lastCall![1].position.clone();
    expect(frames.size).toBe(0);
    controller.setReducedMotion(false);
    frame();
    expect(graphics.render.mock.lastCall![1].position.equals(settled)).toBe(true);
    expect(frames.size).toBe(1);
    frame(frameTime + 1000);
    expect(graphics.render.mock.lastCall![1].position.x).toBeGreaterThan(settled.x);
  });

  it('stops all frames and observers on disposal and ignores later updates', () => {
    const controller = create();
    controller.dispose();
    controller.dispose();
    expect(frames.size).toBe(0);
    expect(disconnectResize).toHaveBeenCalledTimes(1);
    expect(disconnectIntersection).toHaveBeenCalledTimes(1);
    expect(graphics.dispose).toHaveBeenCalledTimes(1);
    controller.setTheme(true);
    controller.setReducedMotion(false);
    document.dispatchEvent(new Event('visibilitychange'));
    controller.replayEntry();
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(frames.size).toBe(0);
    expect(options.onUnavailable).not.toHaveBeenCalled();
  });

  it('disposes and hands over to the fallback when WebGL is lost', () => {
    create();
    frame();
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(graphics.dispose).toHaveBeenCalledTimes(1);
    expect(options.onUnavailable).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('falls back and releases resources if a frame cannot render', () => {
    graphics.render.mockImplementationOnce(() => {
      throw new Error('GPU unavailable');
    });
    create();
    frame();
    expect(options.onUnavailable).toHaveBeenCalledTimes(1);
    expect(options.onReady).not.toHaveBeenCalled();
    expect(graphics.dispose).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('uses a window resize listener when observers are unavailable', () => {
    options.resizeObserver = options.intersectionObserver = false;
    const controller = create();
    frame();
    window.dispatchEvent(new Event('resize'));
    frame();
    expect(graphics.render).toHaveBeenCalledTimes(2);
    controller.dispose();
    window.dispatchEvent(new Event('resize'));
    expect(frames.size).toBe(0);
  });
});
