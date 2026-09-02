import { describe, expect, it, vi } from 'vitest';
import {
  EChartsHorizontalTouchGestureController,
  type EChartsHorizontalTouchPoint,
} from './echarts-horizontal-touch-gesture.controller';

function createTouch(identifier: number, point: EChartsHorizontalTouchPoint): Touch {
  return {
    identifier,
    clientX: point.clientX,
    clientY: point.clientY,
  } as Touch;
}

function createTouchList(touches: Touch[]): TouchList {
  return {
    length: touches.length,
    item: (index: number) => touches[index] ?? null,
    ...touches,
  } as unknown as TouchList;
}

function dispatchTouch(
  element: HTMLElement,
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  touches: Touch[],
  changedTouches = touches,
): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperties(event, {
    touches: { configurable: true, value: createTouchList(touches) },
    changedTouches: { configurable: true, value: createTouchList(changedTouches) },
  });
  element.dispatchEvent(event);
  return event;
}

describe('EChartsHorizontalTouchGestureController', () => {
  it('leaves a vertical fling native and never prevents its default scrolling', () => {
    const element = document.createElement('div');
    const parent = document.createElement('div');
    parent.appendChild(element);
    const parentTouchMove = vi.fn();
    parent.addEventListener('touchmove', parentTouchMove);
    const onHorizontalMove = vi.fn();
    const controller = new EChartsHorizontalTouchGestureController({
      onHorizontalMove,
      onHorizontalEnd: vi.fn(),
    });
    controller.bind(element);

    dispatchTouch(element, 'touchstart', [createTouch(1, { clientX: 40, clientY: 40 })]);
    const moveEvent = dispatchTouch(element, 'touchmove', [createTouch(1, { clientX: 43, clientY: 80 })]);
    dispatchTouch(element, 'touchend', [], [createTouch(1, { clientX: 43, clientY: 120 })]);

    expect(moveEvent.defaultPrevented).toBe(false);
    expect(parentTouchMove).not.toHaveBeenCalled();
    expect(onHorizontalMove).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('locks a clearly horizontal first gesture and reports its original start point', () => {
    const element = document.createElement('div');
    const onHorizontalStart = vi.fn();
    const onHorizontalMove = vi.fn();
    const onHorizontalEnd = vi.fn();
    const controller = new EChartsHorizontalTouchGestureController({
      onHorizontalStart,
      onHorizontalMove,
      onHorizontalEnd,
    });
    controller.bind(element);

    dispatchTouch(element, 'touchstart', [createTouch(7, { clientX: 20, clientY: 50 })]);
    const moveEvent = dispatchTouch(element, 'touchmove', [createTouch(7, { clientX: 55, clientY: 54 })]);
    dispatchTouch(element, 'touchend', [], [createTouch(7, { clientX: 90, clientY: 55 })]);

    expect(moveEvent.defaultPrevented).toBe(false);
    expect(onHorizontalStart).toHaveBeenCalledOnce();
    expect(onHorizontalMove).toHaveBeenCalledWith({
      start: { clientX: 20, clientY: 50 },
      current: { clientX: 55, clientY: 54 },
    });
    expect(onHorizontalEnd).toHaveBeenCalledWith({
      start: { clientX: 20, clientY: 50 },
      current: { clientX: 90, clientY: 55 },
    });
    controller.dispose();
  });

  it('biases ambiguous diagonal movement toward page scrolling', () => {
    const element = document.createElement('div');
    const onHorizontalMove = vi.fn();
    const controller = new EChartsHorizontalTouchGestureController({
      onHorizontalMove,
      onHorizontalEnd: vi.fn(),
    });
    controller.bind(element);

    dispatchTouch(element, 'touchstart', [createTouch(2, { clientX: 10, clientY: 10 })]);
    dispatchTouch(element, 'touchmove', [createTouch(2, { clientX: 24, clientY: 22 })]);

    expect(onHorizontalMove).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('cancels chart interaction when a second touch turns the gesture into a pinch', () => {
    const element = document.createElement('div');
    const onHorizontalCancel = vi.fn();
    const controller = new EChartsHorizontalTouchGestureController({
      onHorizontalMove: vi.fn(),
      onHorizontalEnd: vi.fn(),
      onHorizontalCancel,
    });
    controller.bind(element);

    dispatchTouch(element, 'touchstart', [createTouch(1, { clientX: 20, clientY: 20 })]);
    dispatchTouch(element, 'touchmove', [createTouch(1, { clientX: 60, clientY: 22 })]);
    const secondTouchEvent = dispatchTouch(element, 'touchstart', [
      createTouch(1, { clientX: 60, clientY: 22 }),
      createTouch(2, { clientX: 100, clientY: 22 }),
    ], [createTouch(2, { clientX: 100, clientY: 22 })]);

    expect(secondTouchEvent.defaultPrevented).toBe(false);
    expect(onHorizontalCancel).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('allows compatibility mouse events for taps but suppresses the sequence after a drag', () => {
    const element = document.createElement('div');
    const mouseDownSpy = vi.fn();
    const clickSpy = vi.fn();
    element.addEventListener('mousedown', mouseDownSpy);
    element.addEventListener('click', clickSpy);
    const controller = new EChartsHorizontalTouchGestureController({
      onHorizontalMove: vi.fn(),
      onHorizontalEnd: vi.fn(),
    });
    controller.bind(element);

    dispatchTouch(element, 'touchstart', [createTouch(1, { clientX: 20, clientY: 20 })]);
    dispatchTouch(element, 'touchend', [], [createTouch(1, { clientX: 20, clientY: 20 })]);
    const tapClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    element.dispatchEvent(tapClick);

    dispatchTouch(element, 'touchstart', [createTouch(2, { clientX: 20, clientY: 20 })]);
    dispatchTouch(element, 'touchmove', [createTouch(2, { clientX: 60, clientY: 22 })]);
    dispatchTouch(element, 'touchend', [], [createTouch(2, { clientX: 80, clientY: 22 })]);
    const dragMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    element.dispatchEvent(dragMouseDown);
    const dragClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    element.dispatchEvent(dragClick);

    expect(tapClick.defaultPrevented).toBe(false);
    expect(dragMouseDown.defaultPrevented).toBe(true);
    expect(dragClick.defaultPrevented).toBe(true);
    expect(mouseDownSpy).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('blocks the complete compatibility mouse sequence produced by a long-press', () => {
    const element = document.createElement('div');
    const mouseDownSpy = vi.fn();
    const clickSpy = vi.fn();
    const contextMenuSpy = vi.fn();
    element.addEventListener('mousedown', mouseDownSpy);
    element.addEventListener('click', clickSpy);
    element.addEventListener('contextmenu', contextMenuSpy);
    const controller = new EChartsHorizontalTouchGestureController({
      onHorizontalMove: vi.fn(),
      onHorizontalEnd: vi.fn(),
    });
    controller.bind(element);

    dispatchTouch(element, 'touchstart', [createTouch(1, { clientX: 20, clientY: 20 })]);
    const longPressMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    element.dispatchEvent(longPressMouseDown);
    dispatchTouch(element, 'touchend', [], [createTouch(1, { clientX: 20, clientY: 20 })]);
    const longPressContextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    element.dispatchEvent(longPressContextMenu);
    const completedTapClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    element.dispatchEvent(completedTapClick);

    expect(longPressMouseDown.defaultPrevented).toBe(true);
    expect(longPressContextMenu.defaultPrevented).toBe(true);
    expect(completedTapClick.defaultPrevented).toBe(true);
    expect(mouseDownSpy).not.toHaveBeenCalled();
    expect(contextMenuSpy).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('cancels an active horizontal gesture when disposed', () => {
    const element = document.createElement('div');
    const onHorizontalCancel = vi.fn();
    const controller = new EChartsHorizontalTouchGestureController({
      onHorizontalMove: vi.fn(),
      onHorizontalEnd: vi.fn(),
      onHorizontalCancel,
    });
    controller.bind(element);

    dispatchTouch(element, 'touchstart', [createTouch(1, { clientX: 20, clientY: 20 })]);
    dispatchTouch(element, 'touchmove', [createTouch(1, { clientX: 60, clientY: 22 })]);
    controller.dispose();

    expect(onHorizontalCancel).toHaveBeenCalledOnce();
    dispatchTouch(element, 'touchend', [], [createTouch(1, { clientX: 80, clientY: 22 })]);
    expect(onHorizontalCancel).toHaveBeenCalledOnce();
  });

  it('refreshes compatibility suppression when native scrolling cancels a long gesture', () => {
    const element = document.createElement('div');
    const clickSpy = vi.fn();
    element.addEventListener('click', clickSpy);
    const controller = new EChartsHorizontalTouchGestureController({
      onHorizontalMove: vi.fn(),
      onHorizontalEnd: vi.fn(),
    });
    controller.bind(element);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(0);

    dispatchTouch(element, 'touchstart', [createTouch(1, { clientX: 20, clientY: 20 })]);
    dispatchTouch(element, 'touchmove', [createTouch(1, { clientX: 22, clientY: 80 })]);
    nowSpy.mockReturnValue(1000);
    dispatchTouch(element, 'touchcancel', [], [createTouch(1, { clientX: 22, clientY: 120 })]);
    const compatibilityClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    element.dispatchEvent(compatibilityClick);

    expect(compatibilityClick.defaultPrevented).toBe(true);
    expect(clickSpy).not.toHaveBeenCalled();
    nowSpy.mockRestore();
    controller.dispose();
  });
});
