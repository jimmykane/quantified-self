export interface EChartsHorizontalTouchPoint {
  clientX: number;
  clientY: number;
}

export interface EChartsHorizontalTouchGesture {
  start: EChartsHorizontalTouchPoint;
  current: EChartsHorizontalTouchPoint;
}

export interface EChartsHorizontalTouchGestureCallbacks {
  onHorizontalStart?: (gesture: EChartsHorizontalTouchGesture) => void;
  onHorizontalMove: (gesture: EChartsHorizontalTouchGesture) => void;
  onHorizontalEnd: (gesture: EChartsHorizontalTouchGesture) => void;
  onHorizontalCancel?: () => void;
}

type TouchGestureIntent = 'pending' | 'horizontal' | 'vertical';

type ActiveTouchGesture = {
  identifier: number;
  start: EChartsHorizontalTouchPoint;
  current: EChartsHorizontalTouchPoint;
  intent: TouchGestureIntent;
  maxDistance: number;
};

const DEFAULT_INTENT_THRESHOLD_PX = 8;
const DEFAULT_HORIZONTAL_DOMINANCE_RATIO = 1.25;
const COMPATIBILITY_MOUSE_SUPPRESSION_MS = 700;
const COMPATIBILITY_CONTEXT_MENU_SUPPRESSION_MS = 700;
const PASSIVE_CAPTURE_LISTENER_OPTIONS: AddEventListenerOptions = {
  capture: true,
  passive: true,
};

/**
 * Keeps ECharts' synthetic mouse handlers out of touch gestures until their
 * direction is known. Vertical and pinch gestures remain browser-owned while
 * horizontal gestures are delivered through the callbacks.
 */
export class EChartsHorizontalTouchGestureController {
  private element: HTMLElement | null = null;
  private activeGesture: ActiveTouchGesture | null = null;
  private suppressCompatibilityMouseUntil = 0;
  private suppressCompatibilityContextMenuUntil = 0;

  private readonly touchStartHandler = (event: TouchEvent) => this.onTouchStart(event);
  private readonly touchMoveHandler = (event: TouchEvent) => this.onTouchMove(event);
  private readonly touchEndHandler = (event: TouchEvent) => this.onTouchEnd(event);
  private readonly touchCancelHandler = (event: TouchEvent) => this.onTouchCancel(event);
  private readonly compatibilityMouseHandler = (event: MouseEvent) => this.onCompatibilityMouseEvent(event);

  constructor(
    private readonly callbacks: EChartsHorizontalTouchGestureCallbacks,
    private readonly intentThresholdPx = DEFAULT_INTENT_THRESHOLD_PX,
    private readonly horizontalDominanceRatio = DEFAULT_HORIZONTAL_DOMINANCE_RATIO,
  ) { }

  bind(element: HTMLElement): void {
    if (this.element === element) {
      return;
    }

    this.dispose();
    this.element = element;
    element.addEventListener('touchstart', this.touchStartHandler, PASSIVE_CAPTURE_LISTENER_OPTIONS);
    element.addEventListener('touchmove', this.touchMoveHandler, PASSIVE_CAPTURE_LISTENER_OPTIONS);
    element.addEventListener('touchend', this.touchEndHandler, PASSIVE_CAPTURE_LISTENER_OPTIONS);
    element.addEventListener('touchcancel', this.touchCancelHandler, PASSIVE_CAPTURE_LISTENER_OPTIONS);
    element.addEventListener('mousemove', this.compatibilityMouseHandler, true);
    element.addEventListener('mousedown', this.compatibilityMouseHandler, true);
    element.addEventListener('mouseup', this.compatibilityMouseHandler, true);
    element.addEventListener('click', this.compatibilityMouseHandler, true);
    element.addEventListener('contextmenu', this.compatibilityMouseHandler, true);
  }

  dispose(): void {
    this.cancelActiveGesture();
    if (!this.element) {
      this.suppressCompatibilityMouseUntil = 0;
      this.suppressCompatibilityContextMenuUntil = 0;
      return;
    }

    this.element.removeEventListener('touchstart', this.touchStartHandler, true);
    this.element.removeEventListener('touchmove', this.touchMoveHandler, true);
    this.element.removeEventListener('touchend', this.touchEndHandler, true);
    this.element.removeEventListener('touchcancel', this.touchCancelHandler, true);
    this.element.removeEventListener('mousemove', this.compatibilityMouseHandler, true);
    this.element.removeEventListener('mousedown', this.compatibilityMouseHandler, true);
    this.element.removeEventListener('mouseup', this.compatibilityMouseHandler, true);
    this.element.removeEventListener('click', this.compatibilityMouseHandler, true);
    this.element.removeEventListener('contextmenu', this.compatibilityMouseHandler, true);
    this.element = null;
    this.activeGesture = null;
    this.suppressCompatibilityMouseUntil = 0;
    this.suppressCompatibilityContextMenuUntil = 0;
  }

  private onTouchStart(event: TouchEvent): void {
    this.keepGestureAwayFromECharts(event);

    if (event.touches.length !== 1) {
      this.cancelActiveGesture(true);
      return;
    }

    const touch = event.touches.item(0);
    if (!touch) {
      this.activeGesture = null;
      return;
    }

    const point = this.toPoint(touch);
    this.activeGesture = {
      identifier: touch.identifier,
      start: point,
      current: point,
      intent: 'pending',
      maxDistance: 0,
    };
  }

  private onTouchMove(event: TouchEvent): void {
    this.keepGestureAwayFromECharts(event);

    const activeGesture = this.activeGesture;
    if (!activeGesture || event.touches.length !== 1) {
      this.cancelActiveGesture(true);
      return;
    }

    const touch = this.findTouch(event.touches, activeGesture.identifier);
    if (!touch) {
      this.cancelActiveGesture(true);
      return;
    }

    activeGesture.current = this.toPoint(touch);
    const deltaX = activeGesture.current.clientX - activeGesture.start.clientX;
    const deltaY = activeGesture.current.clientY - activeGesture.start.clientY;
    activeGesture.maxDistance = Math.max(activeGesture.maxDistance, Math.hypot(deltaX, deltaY));

    if (activeGesture.intent === 'pending') {
      activeGesture.intent = this.resolveIntent(deltaX, deltaY);
      if (activeGesture.intent === 'horizontal') {
        this.suppressCompatibilityMouseEvents();
        this.callbacks.onHorizontalStart?.(this.toGesture(activeGesture));
      } else if (activeGesture.intent === 'vertical') {
        this.suppressCompatibilityMouseEvents();
      }
    }

    if (activeGesture.intent === 'horizontal') {
      this.callbacks.onHorizontalMove(this.toGesture(activeGesture));
    }
  }

  private onTouchEnd(event: TouchEvent): void {
    this.keepGestureAwayFromECharts(event);
    this.suppressCompatibilityContextMenu();

    const activeGesture = this.activeGesture;
    if (!activeGesture) {
      return;
    }

    const changedTouch = this.findTouch(event.changedTouches, activeGesture.identifier);
    if (changedTouch) {
      activeGesture.current = this.toPoint(changedTouch);
    }

    if (activeGesture.intent === 'horizontal') {
      this.suppressCompatibilityMouseEvents();
      this.callbacks.onHorizontalEnd(this.toGesture(activeGesture));
    } else if (activeGesture.intent === 'vertical' || activeGesture.maxDistance >= this.intentThresholdPx) {
      this.suppressCompatibilityMouseEvents();
    }

    this.activeGesture = null;
  }

  private onTouchCancel(event: TouchEvent): void {
    this.keepGestureAwayFromECharts(event);
    this.suppressCompatibilityContextMenu();
    this.cancelActiveGesture(true);
  }

  private onCompatibilityMouseEvent(event: MouseEvent): void {
    const touchInProgress = this.activeGesture !== null;
    if (touchInProgress) {
      this.suppressCompatibilityMouseEvents();
    }
    const now = Date.now();
    const contextMenuSuppressed = event.type === 'contextmenu'
      && now <= this.suppressCompatibilityContextMenuUntil;
    if (!touchInProgress && now > this.suppressCompatibilityMouseUntil && !contextMenuSuppressed) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.type === 'click') {
      this.suppressCompatibilityMouseUntil = 0;
    }
  }

  private cancelActiveGesture(forceCompatibilityMouseSuppression = false): void {
    const activeGesture = this.activeGesture;
    if (
      activeGesture
      && (
        forceCompatibilityMouseSuppression
        || activeGesture.intent !== 'pending'
        || activeGesture.maxDistance >= this.intentThresholdPx
      )
    ) {
      this.suppressCompatibilityMouseEvents();
    }
    if (activeGesture?.intent === 'horizontal') {
      this.callbacks.onHorizontalCancel?.();
    }
    this.activeGesture = null;
  }

  private resolveIntent(deltaX: number, deltaY: number): TouchGestureIntent {
    const absoluteX = Math.abs(deltaX);
    const absoluteY = Math.abs(deltaY);
    if (Math.max(absoluteX, absoluteY) < this.intentThresholdPx) {
      return 'pending';
    }

    return absoluteX > absoluteY * this.horizontalDominanceRatio
      ? 'horizontal'
      : 'vertical';
  }

  private keepGestureAwayFromECharts(event: TouchEvent): void {
    // Deliberately do not call preventDefault: native vertical scrolling and
    // pinch zoom must remain compositor-owned and responsive.
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  private suppressCompatibilityMouseEvents(): void {
    this.suppressCompatibilityMouseUntil = Date.now() + COMPATIBILITY_MOUSE_SUPPRESSION_MS;
  }

  private suppressCompatibilityContextMenu(): void {
    this.suppressCompatibilityContextMenuUntil = Date.now() + COMPATIBILITY_CONTEXT_MENU_SUPPRESSION_MS;
  }

  private findTouch(touches: TouchList, identifier: number): Touch | null {
    for (let index = 0; index < touches.length; index += 1) {
      const touch = touches.item(index);
      if (touch?.identifier === identifier) {
        return touch;
      }
    }
    return null;
  }

  private toPoint(touch: Touch): EChartsHorizontalTouchPoint {
    return {
      clientX: touch.clientX,
      clientY: touch.clientY,
    };
  }

  private toGesture(activeGesture: ActiveTouchGesture): EChartsHorizontalTouchGesture {
    return {
      start: activeGesture.start,
      current: activeGesture.current,
    };
  }
}
