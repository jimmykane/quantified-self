import { describe, expect, it } from 'vitest';

import { getViewportConstrainedTooltipPosition } from './echarts-tooltip-position.helper';

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
});
