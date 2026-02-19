export interface PopupScreenPosition {
  x: number;
  y: number;
}

export interface PopupAnchorPositionOptions {
  preferredWidthPx: number;
  preferredHeightPx: number;
  marginPx?: number;
  offsetPx?: number;
  minWidthPx?: number;
  minHeightPx?: number;
  preferAbove?: boolean;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function resolvePopupAnchorPosition(
  anchor: PopupScreenPosition | null | undefined,
  mapElement: HTMLElement | null | undefined,
  options: PopupAnchorPositionOptions
): PopupScreenPosition | null {
  if (!anchor) {
    return null;
  }

  const mapRect = mapElement?.getBoundingClientRect?.();
  if (!mapRect || mapRect.width <= 0 || mapRect.height <= 0) {
    return {
      x: Math.round(anchor.x),
      y: Math.round(anchor.y),
    };
  }

  const marginPx = options.marginPx ?? 12;
  const offsetPx = options.offsetPx ?? 12;
  const minWidthPx = options.minWidthPx ?? 120;
  const minHeightPx = options.minHeightPx ?? 120;
  const preferAbove = options.preferAbove !== false;

  const popupWidth = Math.min(
    options.preferredWidthPx,
    Math.max(minWidthPx, mapRect.width - (marginPx * 2))
  );
  const popupHeight = Math.min(
    options.preferredHeightPx,
    Math.max(minHeightPx, mapRect.height - (marginPx * 2))
  );

  const left = clamp(
    anchor.x - (popupWidth / 2),
    marginPx,
    Math.max(marginPx, mapRect.width - popupWidth - marginPx)
  );

  const aboveTop = anchor.y - popupHeight - offsetPx;
  const belowTop = anchor.y + offsetPx;
  let top = preferAbove ? aboveTop : belowTop;
  if (preferAbove && top < marginPx) {
    top = belowTop;
  } else if (!preferAbove && (top + popupHeight) > (mapRect.height - marginPx)) {
    top = aboveTop;
  }

  top = clamp(
    top,
    marginPx,
    Math.max(marginPx, mapRect.height - popupHeight - marginPx)
  );

  return {
    x: Math.round(left),
    y: Math.round(top),
  };
}

export function correctPopupPositionToViewport(
  current: PopupScreenPosition | null | undefined,
  mapElement: HTMLElement | null | undefined,
  popupElement: HTMLElement | null | undefined,
  marginPx: number = 12
): PopupScreenPosition | null {
  if (!current || !mapElement || !popupElement) {
    return null;
  }

  const popupRect = popupElement.getBoundingClientRect();
  const mapRect = mapElement.getBoundingClientRect();
  if (popupRect.width <= 0 || popupRect.height <= 0 || mapRect.width <= 0 || mapRect.height <= 0) {
    return null;
  }

  let dx = 0;
  let dy = 0;

  const minLeft = mapRect.left + marginPx;
  const maxRight = mapRect.right - marginPx;
  if (popupRect.left < minLeft) {
    dx = minLeft - popupRect.left;
  } else if (popupRect.right > maxRight) {
    dx = -(popupRect.right - maxRight);
  }

  const minTop = mapRect.top + marginPx;
  const maxBottom = mapRect.bottom - marginPx;
  if (popupRect.top < minTop) {
    dy = minTop - popupRect.top;
  } else if (popupRect.bottom > maxBottom) {
    dy = -(popupRect.bottom - maxBottom);
  }

  if (dx === 0 && dy === 0) {
    return null;
  }

  return {
    x: Math.round(current.x + dx),
    y: Math.round(current.y + dy),
  };
}
