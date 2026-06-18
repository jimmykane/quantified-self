import { describe, expect, it } from 'vitest';

import {
  beginTableRowPointerTracking,
  createTableRowActivationState,
  shouldActivateTableRowFromClick,
  shouldActivateTableRowFromKeyboard,
  updateTableRowPointerTracking,
} from './table-row-activation.helper';

function createPointerLikeEvent(
  type: string,
  target: Element,
  overrides: Partial<PointerEvent> = {},
): PointerEvent {
  const event = new MouseEvent(type, {
    button: overrides.button ?? 0,
    clientX: overrides.clientX ?? 0,
    clientY: overrides.clientY ?? 0,
    bubbles: true,
  }) as PointerEvent;

  Object.defineProperty(event, 'pointerId', { value: overrides.pointerId ?? 1 });
  Object.defineProperty(event, 'isPrimary', { value: overrides.isPrimary ?? true });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

function createClickEvent(target: Element): MouseEvent {
  const event = new MouseEvent('click', { button: 0, bubbles: true });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('table-row-activation.helper', () => {
  it('activates row clicks when the pointer does not drag', () => {
    const state = createTableRowActivationState();
    const cell = document.createElement('td');

    const pointerDown = createPointerLikeEvent('pointerdown', cell, {
      button: 0,
      clientX: 24,
      clientY: 32,
      isPrimary: true,
      pointerId: 1,
    });
    beginTableRowPointerTracking(state, pointerDown);

    expect(state.suppressClick).toBe(false);

    const clickEvent = createClickEvent(cell);

    expect(shouldActivateTableRowFromClick(state, clickEvent)).toBe(true);
  });

  it('suppresses row activation after pointer drag exceeds the threshold', () => {
    const state = createTableRowActivationState();
    const cell = document.createElement('td');

    const pointerDown = createPointerLikeEvent('pointerdown', cell, {
      button: 0,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
      pointerId: 4,
    });
    beginTableRowPointerTracking(state, pointerDown);

    const pointerMove = createPointerLikeEvent('pointermove', cell, {
      button: 0,
      clientX: 28,
      clientY: 12,
      isPrimary: true,
      pointerId: 4,
    });
    updateTableRowPointerTracking(state, pointerMove);

    const clickEvent = createClickEvent(cell);

    expect(shouldActivateTableRowFromClick(state, clickEvent)).toBe(false);
  });

  it('never activates row clicks from interactive descendants', () => {
    const state = createTableRowActivationState();
    const button = document.createElement('button');

    const pointerDown = createPointerLikeEvent('pointerdown', button, {
      button: 0,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
      pointerId: 5,
    });
    beginTableRowPointerTracking(state, pointerDown);

    expect(state.activePointerId).toBeNull();

    const clickEvent = createClickEvent(button);

    expect(shouldActivateTableRowFromClick(state, clickEvent)).toBe(false);
  });

  it('never activates row keyboard handlers from interactive descendants', () => {
    const button = document.createElement('button');
    const keyboardEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    Object.defineProperty(keyboardEvent, 'target', { value: button });

    expect(shouldActivateTableRowFromKeyboard(keyboardEvent)).toBe(false);
  });
});
