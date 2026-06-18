export interface TableRowActivationState {
  activePointerId: number | null;
  startX: number;
  startY: number;
  suppressClick: boolean;
}

const ROW_DRAG_THRESHOLD_PX = 6;
const INTERACTIVE_TARGET_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'label',
  '[role="button"]',
  '[role="link"]',
  '[mat-menu-item]',
  '[contenteditable="true"]',
  '.mat-mdc-checkbox',
  '.mdc-checkbox',
].join(', ');

export function createTableRowActivationState(): TableRowActivationState {
  return {
    activePointerId: null,
    startX: 0,
    startY: 0,
    suppressClick: false,
  };
}

export function beginTableRowPointerTracking(state: TableRowActivationState, event: PointerEvent): void {
  if (!event.isPrimary || event.button !== 0 || isInteractiveRowActivationTarget(event)) {
    return;
  }

  state.activePointerId = event.pointerId;
  state.startX = event.clientX;
  state.startY = event.clientY;
  state.suppressClick = false;
}

export function updateTableRowPointerTracking(state: TableRowActivationState, event: PointerEvent): void {
  if (state.activePointerId !== event.pointerId || state.suppressClick) {
    return;
  }

  const deltaX = Math.abs(event.clientX - state.startX);
  const deltaY = Math.abs(event.clientY - state.startY);
  if (deltaX > ROW_DRAG_THRESHOLD_PX || deltaY > ROW_DRAG_THRESHOLD_PX) {
    state.suppressClick = true;
  }
}

export function endTableRowPointerTracking(state: TableRowActivationState, event: PointerEvent): void {
  if (state.activePointerId !== event.pointerId) {
    return;
  }

  state.activePointerId = null;
}

export function cancelTableRowPointerTracking(state: TableRowActivationState, event: PointerEvent): void {
  if (state.activePointerId !== event.pointerId) {
    return;
  }

  state.activePointerId = null;
  state.suppressClick = true;
}

export function shouldActivateTableRowFromClick(state: TableRowActivationState, event: MouseEvent): boolean {
  if (isInteractiveRowActivationTarget(event)) {
    state.suppressClick = false;
    state.activePointerId = null;
    return false;
  }

  const shouldActivate = !state.suppressClick;
  state.suppressClick = false;
  state.activePointerId = null;
  return shouldActivate;
}

export function shouldActivateTableRowFromKeyboard(event: KeyboardEvent): boolean {
  return !isInteractiveRowActivationTarget(event);
}

function isInteractiveRowActivationTarget(event: Event): boolean {
  const target = event.target;
  return target instanceof Element && !!target.closest(INTERACTIVE_TARGET_SELECTOR);
}
