import { describe, expect, it } from 'vitest';

import { buildViewportHostedTooltipPosition, getViewportConstrainedTooltipPosition } from './echarts-tooltip-position.helper';

describe('echarts-tooltip-position.helper', () => {
  it('should offset the tooltip from the pointer when there is enough space', () => {
    expect(
      getViewportConstrainedTooltipPosition(
        [100, 80],
        undefined,
        {} as HTMLElement,
        undefined,
        { contentSize: [120, 60], viewSize: [500, 300] }
      )
    ).toEqual([112, 92]);
  });

  it('should flip the tooltip to the left when it would overflow on the right', () => {
    expect(
      getViewportConstrainedTooltipPosition(
        [280, 80],
        undefined,
        {} as HTMLElement,
        undefined,
        { contentSize: [120, 60], viewSize: [320, 300] }
      )
    ).toEqual([148, 92]);
  });

  it('should flip the tooltip upward when it would overflow on the bottom', () => {
    expect(
      getViewportConstrainedTooltipPosition(
        [120, 180],
        undefined,
        {} as HTMLElement,
        undefined,
        { contentSize: [100, 70], viewSize: [320, 220] }
      )
    ).toEqual([132, 98]);
  });

  it('should clamp oversized tooltips within the visible area', () => {
    expect(
      getViewportConstrainedTooltipPosition(
        [10, 10],
        undefined,
        {} as HTMLElement,
        undefined,
        { contentSize: [500, 300], viewSize: [320, 220] }
      )
    ).toEqual([8, 8]);
  });

  it('keeps a tooltip wider than its right-hand mini-chart within the phone viewport', () => {
    const chart = {
      ownerDocument: { documentElement: { clientWidth: 320, clientHeight: 800 } },
      getBoundingClientRect: () => ({ left: 172, top: 460 }),
    } as unknown as HTMLElement;
    const position = buildViewportHostedTooltipPosition(chart);
    const [left, top] = position([56, 19], undefined, {} as HTMLElement, undefined, { contentSize: [242, 86], viewSize: [106, 38] });
    expect([left + 172, top + 460]).toEqual([8, 491]);
    expect(left).toBeLessThan(0); // ECharts translates this outside the small chart into the shared host.
  });

  it('reads live chart bounds and viewport dimensions after scrolling or resizing', () => {
    const bounds = { left: 172, top: 770 };
    const viewport = { clientWidth: 320, clientHeight: 800 };
    const chart = { ownerDocument: { documentElement: viewport }, getBoundingClientRect: () => bounds } as unknown as HTMLElement;
    const position = buildViewportHostedTooltipPosition(chart);
    expect(position([56, 19], undefined, {} as HTMLElement, undefined, { contentSize: [242, 86] })).toEqual([-164, -79]);
    bounds.left = 20;
    bounds.top = 40;
    viewport.clientWidth = 1440;
    expect(position([56, 19], undefined, {} as HTMLElement, undefined, { contentSize: [242, 86] })).toEqual([68, 31]);
  });
});
