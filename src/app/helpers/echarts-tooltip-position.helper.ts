export interface EChartsTooltipPositionSize {
  contentSize?: number[];
  viewSize?: number[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toFiniteCoordinate(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function getViewportConstrainedTooltipPosition(
  point: number[] | undefined,
  _params: unknown,
  _dom: unknown,
  _rect: unknown,
  size: EChartsTooltipPositionSize | undefined
): [number, number] {
  const [contentWidth = 0, contentHeight = 0] = size?.contentSize ?? [];
  const [viewWidth = 0, viewHeight = 0] = size?.viewSize ?? [];
  const x = toFiniteCoordinate(point?.[0]);
  const y = toFiniteCoordinate(point?.[1]);
  const offset = 12;
  const edgePadding = 8;

  let nextX = x + offset;
  let nextY = y + offset;

  if (viewWidth > 0 && nextX + contentWidth > viewWidth - edgePadding) {
    nextX = x - contentWidth - offset;
  }

  if (viewHeight > 0 && nextY + contentHeight > viewHeight - edgePadding) {
    nextY = y - contentHeight - offset;
  }

  const maxX = Math.max(edgePadding, viewWidth - contentWidth - edgePadding);
  const maxY = Math.max(edgePadding, viewHeight - contentHeight - edgePadding);

  return [
    clamp(nextX, edgePadding, maxX),
    clamp(nextY, edgePadding, maxY),
  ];
}

/** ECharts gives position callbacks chart-local coordinates and chart size, not browser size.
 * Tiny plots need room outside their chart. Reuse the shared clamp in viewport coordinates,
 * then return chart-local coordinates for ECharts to translate into the shared tooltip host. */
export function buildViewportHostedTooltipPosition(chartContainer: HTMLElement): typeof getViewportConstrainedTooltipPosition {
  return (point, params, dom, rect, size) => {
    const doc = chartContainer.ownerDocument;
    const width = doc.documentElement.clientWidth || doc.defaultView?.innerWidth || 0;
    const height = doc.documentElement.clientHeight || doc.defaultView?.innerHeight || 0;
    if (width <= 0 || height <= 0) return getViewportConstrainedTooltipPosition(point, params, dom, rect, size);
    // Read current bounds on every interaction: the grid can resize or scroll without new data.
    const bounds = chartContainer.getBoundingClientRect();
    const [left, top] = getViewportConstrainedTooltipPosition(
      [bounds.left + toFiniteCoordinate(point?.[0]), bounds.top + toFiniteCoordinate(point?.[1])],
      params, dom, rect, { ...size, viewSize: [width, height] },
    );
    return [left - bounds.left, top - bounds.top];
  };
}
