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
  const disconnectResize = vi.fn(),
    disconnectIntersection = vi.fn();
  let options: TerrainOptions;
  const controllers: ReturnType<typeof createTerrainRenderer>[] = [];
  beforeEach(() => {
    vi.clearAllMocks();
    frames = new Map();
    hidden = false;
    nextFrame = 0;
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
  function frame(time = 16) {
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

  it('settles pointer parallax and does not keep repainting an idle scene', () => {
    options.reducedMotion = false;
    create();
    frame();
    const camera = graphics.render.mock.lastCall![1];
    const initial = camera.position.clone();
    expect(frames.size).toBe(0);
    move();
    frame();
    expect(camera.position.x).toBeGreaterThan(initial.x);
    expect(frames.size).toBe(1);
    for (let i = 0; i < 200; i++) frame();
    expect(frames.size).toBe(0);
    const count = graphics.render.mock.calls.length;
    frame();
    expect(graphics.render).toHaveBeenCalledTimes(count);
    stage.dispatchEvent(new Event('pointerleave'));
    for (let i = 0; i < 200; i++) frame();
    expect(camera.position.distanceTo(initial)).toBeLessThan(0.001);
    expect(frames.size).toBe(0);
  });

  it('ignores touch parallax and resets the camera when reduced motion is enabled', () => {
    options.reducedMotion = false;
    const controller = create();
    frame();
    const camera = graphics.render.mock.lastCall![1];
    const initial = camera.position.clone();
    move('touch');
    expect(frames.size).toBe(0);
    move();
    frame();
    expect(camera.position.distanceTo(initial)).toBeGreaterThan(0);
    controller.setReducedMotion(true);
    frame();
    expect(camera.position.equals(initial)).toBe(true);
    expect(frames.size).toBe(0);
    move();
    expect(frames.size).toBe(0);
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
